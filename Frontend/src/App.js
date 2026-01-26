import React, { useState, useRef, useEffect } from "react";
import FocusTrap from "./utils/FocusTrap";
import "./App.css";

function App() {
  const [mobileLeftOpen, setMobileLeftOpen] = useState(false);
  useEffect(() => {
    try {
      const root = document.querySelector('.App');
      if (root) {
        if (mobileLeftOpen) root.classList.add('mobile-left-open');
        else root.classList.remove('mobile-left-open');
      }
    } catch (e) {}
  }, [mobileLeftOpen]);

  // listen for global close event (dispatched from LeftPanel close button)
  useEffect(() => {
    function onClose() { setMobileLeftOpen(false); }
    window.addEventListener('close_mobile_left', onClose as EventListener);
    return () => window.removeEventListener('close_mobile_left', onClose as EventListener);
  }, []);

  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState([
    { role: "assistant", content: "Welcome back! How are you feeling today?" },
    { role: "user", content: "I’m feeling anxious about work." },
    { role: "assistant", content: "I hear you. Want to talk about it?" },
  ]);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);

  const chatEndRef = useRef(null);
  const handleStarterClick = (text) => {
  // Add clicked prompt as bot message
  setConversation((prev) => [...prev, { role: "assistant", content: text }]);
  // Optionally clear input
  setMessage("");
  };
  const starterPrompts = [
  "Something you want to share about today?",
  "How was your presentation?",
  "Any stressful moments recently?",
  "What made you happy today?",
];

// Function to click prompt
const handlePromptClick = (text) => {
  setMessage(text);
};

  // Auto-scroll
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [conversation, typing]);

  // Mock user info
  const user = {
    name: "Ankur",
    subscription: "Free trial",
    credits: 15, // minutes
  };

  const sendMessage = async () => {
    if (!message.trim()) return;

    const userMessage = { role: "user", content: message };
    setConversation((prev) => [...prev, userMessage]);
    setMessage("");
    setLoading(true);
    setTyping(true);

    try {
      const res = await fetch("http://127.0.0.1:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message }),
      });
      const data = await res.json();

      const botMessage = { role: "assistant", content: data.reply };
      setConversation((prev) => [...prev, botMessage]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setTyping(false);
    }
  };

  const getSummary = async () => {
    if (conversation.length === 0) return;

    setLoading(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation }),
      });
      const data = await res.json();
      setSummary(data.summary);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      {/* Mobile menu toggle */}
      <button className="mobile-menu-btn" aria-label="Open menu" onClick={() => setMobileLeftOpen((s) => !s)}>
        ☰
      </button>
      {/* Mobile drawer overlay and close button */}
      {mobileLeftOpen && (
        <>
          <div className={"overlay open"} onClick={() => setMobileLeftOpen(false)} />
          <button className="drawer-close-btn" aria-label="Close menu" onClick={() => setMobileLeftOpen(false)}>✕</button>
          <FocusTrap active={mobileLeftOpen} containerSelector={".left-panel"} />
        </>
      )}
      {/* Header / account info */}
      <header className="app-header">
        <h2>Therapy Chat</h2>
        <div className="user-info">
          <span>{user.name}</span> | <span>{user.subscription}</span> |{" "}
          <span>{user.credits} min</span>
        </div>
      </header>

      {/* Chat box */}
      <div className="chat-box">
        {conversation.map((msg, index) => (
          <div
            key={index}
            className={msg.role === "user" ? "user-msg" : "bot-msg"}
          >
            <b>{msg.role === "user" ? "You" : "Bot"}:</b> {msg.content}
          </div>
        ))}
        {typing && <div className="bot-msg typing">Bot is typing...</div>}
        <div ref={chatEndRef} />
      </div>
      
      {/* Bot conversation starter buttons */}
      <div className="starter-buttons">
        {starterPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleStarterClick(prompt)}
            className="starter-btn"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Input area */}
      <div className="input-area">
        <input
          type="text"
          id="main-input"
          name="main_input"
          aria-label="Main chat input"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your message..."
        />
        <button onClick={sendMessage} disabled={loading}>
          Send
        </button>
        <button onClick={getSummary} disabled={loading}>
          Get Summary
        </button>
      </div>

      {/* Summary box */}
      {summary && (
        <div className="summary-box">
          <h3>Summary</h3>
          <p>{summary}</p>
        </div>
      )}
    </div>
  );
}

export default App;
