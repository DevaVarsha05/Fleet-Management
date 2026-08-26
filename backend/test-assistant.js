fetch("http://localhost:5000/api/assistant/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
body: JSON.stringify({ message: "Give me a current fleet summary", history: [] }),
})
  .then((res) => res.json())
  .then((data) => console.log("Response:", data))
  .catch((err) => console.error("Request failed:", err));