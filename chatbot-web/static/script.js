// ── DOM Elements ──────────────────────────────────────────────────
const apiKeyModal = document.getElementById('apiKeyModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const connectBtn = document.getElementById('connectBtn');
const toggleApiKeyVisibility = document.getElementById('toggleApiKeyVisibility');
const apiKeyError = document.getElementById('apiKeyError');
const apiKeyBtn = document.getElementById('apiKeyBtn');
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const tokenCounter = document.getElementById('tokenCounter');
const systemPromptInput = document.getElementById('systemPromptInput');
const maxTokensValue = document.getElementById('maxTokensValue');
const tempSlider = document.getElementById('tempSlider');
const tempValue = document.getElementById('tempValue');

// ── State ─────────────────────────────────────────────────────────
let apiKey = null;
let totalTokens = 0;
let messages = [];
let isLoading = false;

// ── API Key Management ────────────────────────────────────────────
connectBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
        showApiKeyError('Please enter an API key');
        return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    
    try {
        // Test API key with a simple health check
        const response = await fetch('/health');
        if (response.ok) {
            apiKey = key;
            apiKeyModal.style.display = 'none';
            chatContainer.style.display = 'flex';
            messageInput.focus();
            addMessage('Connected! How can I help you?', 'system');
            apiKeyError.style.display = 'none';
        } else {
            showApiKeyError('Failed to connect. Check your API key.');
        }
    } catch (error) {
        showApiKeyError(`Connection error: ${error.message}`);
    } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect';
    }
});

toggleApiKeyVisibility.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleApiKeyVisibility.textContent = isPassword ? 'Hide' : 'Show';
});

apiKeyBtn.addEventListener('click', () => {
    apiKey = null;
    messages = [];
    totalTokens = 0;
    chatBox.replaceChildren();
    apiKeyModal.style.display = 'flex';
    chatContainer.style.display = 'none';
    apiKeyInput.value = '';
    apiKeyInput.type = 'password';
    toggleApiKeyVisibility.textContent = 'Show';
});

function showApiKeyError(message) {
    apiKeyError.textContent = message;
    apiKeyError.style.display = 'block';
}

// ── Settings ──────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
    settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
});

closeSettings.addEventListener('click', () => {
    settingsPanel.style.display = 'none';
});

maxTokensSlider.addEventListener('input', (e) => {
    maxTokensValue.textContent = e.target.value;
});

tempSlider.addEventListener('input', (e) => {
    tempValue.textContent = e.target.value;
});

// ── Chat Functions ───────────────────────────────────────────────
async function sendMessage() {
    if (isLoading || !apiKey) return;
    
    const userMessage = messageInput.value.trim();
    if (!userMessage) return;
    
    messageInput.value = '';
    addMessage(userMessage, 'user');
    isLoading = true;
    sendBtn.disabled = true;
    
    const loadingId = addMessage('Thinking...', 'assistant');
    
    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                api_key: apiKey,
                message: userMessage,
                messages: messages,
                system_prompt: systemPromptInput.value,
                max_tokens: parseInt(maxTokensSlider.value),
                temperature: parseFloat(tempSlider.value)
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            removeMessage(loadingId);
            const errorMsg = data.error || `Error: ${response.status}`;
            addMessage(`❌ ${errorMsg}`, 'error');
            
            if (response.status === 401 || response.status === 403) {
                setTimeout(() => {
                    apiKeyBtn.click();
                }, 2000);
            }
            return;
        }
        
        // Update messages history
        messages.push({ role: 'user', content: userMessage });
        messages.push({ role: 'assistant', content: data.response });
        
        // Update UI
        removeMessage(loadingId);
        addMessage(data.response, 'assistant');
        
        if (data.tokens) {
            totalTokens += data.tokens;
            tokenCounter.textContent = `${totalTokens} tokens`;
        }
    } catch (error) {
        removeMessage(loadingId);
        addMessage(`❌ Network error: ${error.message}`, 'error');
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

clearBtn.addEventListener('click', () => {
    if (confirm('Clear all messages?')) {
        messages = [];
        totalTokens = 0;
        chatBox.replaceChildren();
        tokenCounter.textContent = '0 tokens';
        addMessage('Chat cleared. Ready for new conversation.', 'system');
    }
});

// ── Message Display ──────────────────────────────────────────────
function addMessage(text, role) {
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${role}`;
    messageEl.id = `msg-${Date.now()}-${Math.random()}`;
    
    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';
    
    // Parse markdown-like formatting
    const formattedText = parseMessageContent(text);
    contentEl.appendChild(formattedText);
    
    messageEl.appendChild(contentEl);
    chatBox.appendChild(messageEl);
    chatBox.scrollTop = chatBox.scrollHeight;
    
    return messageEl.id;
}

function removeMessage(messageId) {
    const messageEl = document.getElementById(messageId);
    if (messageEl) {
        messageEl.remove();
    }
}

function parseMessageContent(text) {
    const container = document.createElement('div');
    
    // Split by common markdown patterns
    const parts = text.split(/(\*\*.*?\*\*|__.*?__|`.*?`|\n|^#{1,6}\s.*?$)/gm);
    
    parts.forEach(part => {
        if (!part) return;
        
        // Bold
        if (part.startsWith('**') && part.endsWith('**')) {
            const strong = document.createElement('strong');
            strong.textContent = part.slice(2, -2);
            container.appendChild(strong);
        }
        // Code
        else if (part.startsWith('`') && part.endsWith('`')) {
            const code = document.createElement('code');
            code.textContent = part.slice(1, -1);
            container.appendChild(code);
        }
        // Line break
        else if (part === '\n') {
            container.appendChild(document.createElement('br'));
        }
        // Heading
        else if (part.match(/^#{1,6}\s/)) {
            const level = part.match(/^#+/)[0].length;
            const heading = document.createElement(`h${level}`);
            heading.textContent = part.replace(/^#+\s/, '');
            container.appendChild(heading);
        }
        // Plain text
        else {
            const span = document.createElement('span');
            span.textContent = part;
            container.appendChild(span);
        }
    });
    
    return container;
}
