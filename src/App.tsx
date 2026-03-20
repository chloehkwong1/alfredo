function App() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "1rem",
      }}
    >
      <img
        src="/alfredi-logo.png"
        width="80"
        height="80"
        alt="Alfredo"
        style={{ borderRadius: "16px" }}
      />
      <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Alfredo</h1>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
        AI Agent Management
      </p>
    </div>
  );
}

export default App;
