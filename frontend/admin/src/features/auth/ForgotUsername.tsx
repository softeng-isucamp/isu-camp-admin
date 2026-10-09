import { Button } from "../../components/UI";
import { useReturnToLogin } from "./loginPrefill";
import { RecoveryFlow, type VerifiedRecovery } from "./RecoveryFlow";

/** `/forgot-username`: verify a code sent to the admin's email, then show their username. */
export function ForgotUsername() {
  return (
    <RecoveryFlow
      purpose="username"
      title="Find your username"
      description="Enter your admin email to receive a six-digit code."
      renderFinal={(verified) => <UsernameResult verified={verified} />}
    />
  );
}

function UsernameResult({ verified }: { verified: VerifiedRecovery }) {
  const returnToLogin = useReturnToLogin();

  return (
    <>
      <h2>Your username</h2>
      <p className="muted recovery-copy">Use this username to sign in to the admin console.</p>
      <p className="recovery-username">{verified.username}</p>
      <Button className="recovery-primary" onClick={() => returnToLogin(verified.username)}>
        Continue to login
      </Button>
    </>
  );
}
