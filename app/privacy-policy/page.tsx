export default function PrivacyPolicyPage() {
  return (
    <main className="app-shell">
      <section className="timer-card auth-card">
        <p className="eyebrow">Legal</p>
        <h1>Privacy Policy</h1>
        <p className="subtitle">Last updated: February 9, 2026</p>

        <section className="settings-panel">
          <p>
            Pulse Pomodoro stores account, project, and focus-log data to provide timing, analytics, and rank features.
            If you connect Oura, we store OAuth tokens and request only wearable metrics needed for dashboard display
            (heart rate and stress).
          </p>
          <p>
            We do not sell personal data. Data is processed to operate the app and can be removed by deleting your
            account or disconnecting Oura.
          </p>
          <p>Contact: srikanthsmedicherla@gmail.com</p>
        </section>
      </section>
    </main>
  );
}
