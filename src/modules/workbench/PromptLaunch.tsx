import { useState } from "react";
import { AiProvider, Card, Chat } from "./types";
import { wb } from "./mockData";
import { Field, Modal, useToast } from "../../components/ui";
import { detectVariables } from "./CardEditor";

const MULTILINE_VARS = ["text", "content", "input", "code"];

/** Fill-in form for a prompt card's `{{variables}}`, then starts a chat with
 *  the rendered body. Skipped entirely by the caller when there are none. */
export default function PromptLaunch({
  card,
  providers,
  onClose,
  onLaunched,
}: {
  card: Card;
  providers: AiProvider[];
  onClose: () => void;
  onLaunched: (chat: Chat) => void;
}) {
  const variables = detectVariables(card.body);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(variables.map((v) => [v, ""]))
  );
  const options = providers
    .filter((p) => p.enabled)
    .flatMap((p) => p.models.map((m) => ({ key: `${p.id}:${m}`, label: `${p.name} · ${m}` })));
  const [model, setModel] = useState<string>(options[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rendered = variables.reduce((body, v) => body.replaceAll(`{{${v}}}`, values[v] ?? ""), card.body);

  const launch = async () => {
    if (!model || busy) return;
    setBusy(true);
    try {
      const chat = await wb.chatSend({
        chat_id: null,
        mode: "single",
        models: [model],
        topic: card.topic || null,
        person_id: card.person_id,
        content: rendered,
      });
      onLaunched(chat);
    } catch (e) {
      toast(String(e), "bad");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Launch: ${card.title}`} onClose={onClose}>
      {variables.length === 0 && <p className="text-mut text-[12.5px] mb-2.5">This prompt has no variables — it will be sent as-is.</p>}
      {variables.map((v) => (
        <Field key={v} label={v}>
          {MULTILINE_VARS.includes(v.toLowerCase()) ? (
            <textarea className="ctl min-h-20" value={values[v]} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
          ) : (
            <input className="ctl" value={values[v]} onChange={(e) => setValues({ ...values, [v]: e.target.value })} />
          )}
        </Field>
      ))}
      <Field label="Model">
        {options.length === 0 ? (
          <span className="text-mut text-[12px]">No models configured — Settings → AI Providers</span>
        ) : (
          <select className="ctl" value={model} onChange={(e) => setModel(e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <button className="btn-edge" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-acc" onClick={launch} disabled={busy || !model}>
          {busy ? "Launching…" : "Launch →"}
        </button>
      </div>
    </Modal>
  );
}
