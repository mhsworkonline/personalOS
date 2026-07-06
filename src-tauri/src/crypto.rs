//! Key derivation and backup encryption.
//!
//! See SECURITY.md at the repository root for a plain-language description
//! of the full scheme. Summary:
//!
//! - The master password is run through Argon2id (64 MiB, 3 iterations) with a
//!   random 16-byte salt to produce a 32-byte key. That key is handed to
//!   SQLCipher as a raw key (`PRAGMA key = "x'..'"`), so the entire database
//!   file is encrypted at rest (AES-256-CBC per page, HMAC-SHA512 integrity).
//! - The salt and Argon2 parameters are stored in a small plaintext meta file
//!   next to the database. They are not secret; only the password is.
//! - Neither the password nor the derived key is ever written to disk. The
//!   derived key lives in a `Zeroizing` buffer that is wiped when dropped
//!   (i.e. on lock, auto-lock, or app exit).
//! - Backups are a JSON dump encrypted with XChaCha20-Poly1305 under a key
//!   derived (Argon2id, fresh salt) from a backup password chosen at export
//!   time.

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::Path;
use zeroize::Zeroizing;

pub const DEFAULT_M_COST_KIB: u32 = 65536; // 64 MiB
pub const DEFAULT_T_COST: u32 = 3;
pub const DEFAULT_P_COST: u32 = 1;

#[derive(Serialize, Deserialize, Clone)]
pub struct KdfParams {
    pub algorithm: String,
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
    pub salt_b64: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MetaFile {
    pub version: u32,
    pub kdf: KdfParams,
}

pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

pub fn new_meta() -> MetaFile {
    MetaFile {
        version: 1,
        kdf: KdfParams {
            algorithm: "argon2id".into(),
            m_cost_kib: DEFAULT_M_COST_KIB,
            t_cost: DEFAULT_T_COST,
            p_cost: DEFAULT_P_COST,
            salt_b64: B64.encode(random_bytes(16)),
        },
    }
}

pub fn load_meta(path: &Path) -> Result<MetaFile, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| format!("Cannot read meta file: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Corrupt meta file: {e}"))
}

pub fn save_meta(path: &Path, meta: &MetaFile) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| format!("Cannot write meta file: {e}"))
}

fn derive_raw(
    password: &str,
    salt: &[u8],
    m_cost_kib: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Zeroizing<[u8; 32]>, String> {
    if password.is_empty() {
        return Err("Password must not be empty".into());
    }
    let params = Params::new(m_cost_kib, t_cost, p_cost, Some(32))
        .map_err(|e| format!("Bad KDF params: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(password.as_bytes(), salt, out.as_mut())
        .map_err(|e| format!("Key derivation failed: {e}"))?;
    Ok(out)
}

pub fn derive_key(password: &str, kdf: &KdfParams) -> Result<Zeroizing<[u8; 32]>, String> {
    if kdf.algorithm != "argon2id" {
        return Err(format!("Unsupported KDF: {}", kdf.algorithm));
    }
    let salt = B64
        .decode(&kdf.salt_b64)
        .map_err(|e| format!("Corrupt salt: {e}"))?;
    derive_raw(password, &salt, kdf.m_cost_kib, kdf.t_cost, kdf.p_cost)
}

// ---------------------------------------------------------------------------
// Encrypted backup container
// Layout: "POSBK1" | version(1) | salt(16) | nonce(24) | ciphertext
// ---------------------------------------------------------------------------

const MAGIC: &[u8; 6] = b"POSBK1";

pub fn encrypt_backup(password: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let salt = random_bytes(16);
    let nonce_bytes = random_bytes(24);
    let key = derive_raw(
        password,
        &salt,
        DEFAULT_M_COST_KIB,
        DEFAULT_T_COST,
        DEFAULT_P_COST,
    )?;
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let ct = cipher
        .encrypt(XNonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| "Encryption failed".to_string())?;
    let mut out = Vec::with_capacity(6 + 1 + 16 + 24 + ct.len());
    out.extend_from_slice(MAGIC);
    out.push(1u8);
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt_backup(password: &str, data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 6 + 1 + 16 + 24 + 16 || &data[0..6] != MAGIC {
        return Err("Not a PersonalOS backup file".into());
    }
    if data[6] != 1 {
        return Err("Unsupported backup version".into());
    }
    let salt = &data[7..23];
    let nonce = &data[23..47];
    let ct = &data[47..];
    let key = derive_raw(
        password,
        salt,
        DEFAULT_M_COST_KIB,
        DEFAULT_T_COST,
        DEFAULT_P_COST,
    )?;
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    cipher
        .decrypt(XNonce::from_slice(nonce), ct)
        .map_err(|_| "Wrong backup password or corrupted file".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kdf_is_deterministic_and_salt_sensitive() {
        let meta = new_meta();
        let k1 = derive_key("hunter2", &meta.kdf).unwrap();
        let k2 = derive_key("hunter2", &meta.kdf).unwrap();
        assert_eq!(k1.as_ref(), k2.as_ref());
        let k3 = derive_key("hunter3", &meta.kdf).unwrap();
        assert_ne!(k1.as_ref(), k3.as_ref());
        let meta2 = new_meta();
        let k4 = derive_key("hunter2", &meta2.kdf).unwrap();
        assert_ne!(k1.as_ref(), k4.as_ref());
    }

    #[test]
    fn backup_roundtrip_and_wrong_password() {
        let data = b"{\"hello\":\"world\"}";
        let enc = encrypt_backup("backup-pass", data).unwrap();
        assert_ne!(&enc[..], &data[..]);
        let dec = decrypt_backup("backup-pass", &enc).unwrap();
        assert_eq!(dec, data);
        assert!(decrypt_backup("wrong", &enc).is_err());
        assert!(decrypt_backup("backup-pass", b"garbage").is_err());
    }
}
