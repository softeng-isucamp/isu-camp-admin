import { passwordRules } from "../services/passwordRules";

/** The live list of password rules and which of them `password` already meets. */
export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="recovery-rules" aria-label="Password requirements">
      {passwordRules.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.id} className={met ? "rule-met" : "rule-unmet"} aria-label={`${met ? "Met" : "Not met"}: ${rule.label}`}>
            <span aria-hidden="true">{met ? "✓" : "○"}</span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
