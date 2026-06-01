const chatBox = document.getElementById('chatBox');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');

let isLoading = false;

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !isLoading) {
        sendMessage();
    }
});

async function sendMessage() {
    const message = messageInput.value.trim();

    if (!message || isLoading) return;

    isLoading = true;
    sendBtn.disabled = true;
    messageInput.disabled = true;

    addMessage(message, 'user');
    messageInput.value = '';

    const loadingId = addLoadingMessage();

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        removeMessage(loadingId);
        addMessage(data.message, 'assistant');
    } catch (error) {
        console.error('Error:', error);
        removeMessage(loadingId);
        addMessage(`Error: ${error.message}`, 'assistant');
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        messageInput.disabled = false;
        messageInput.focus();
    }
}

function addMessage(text, role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    if (role === 'assistant') {
        messageDiv.appendChild(renderMarkdown(text));
    } else {
        messageDiv.textContent = text;
    }

    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return messageDiv;
}

function renderMarkdown(text) {
    const fragment = document.createDocumentFragment();
    const codeFencePattern = /```([\w#+.-]*)\s*\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeFencePattern.exec(text)) !== null) {
        appendFormattedText(fragment, text.slice(lastIndex, match.index));
        appendCodeBlock(fragment, match[2].replace(/\n$/, ''), match[1] || 'text');
        lastIndex = codeFencePattern.lastIndex;
    }

    appendFormattedText(fragment, text.slice(lastIndex));
    return fragment;
}

function appendFormattedText(parent, text) {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return;

    const blocks = normalized.split(/\n{2,}/);
    blocks.forEach((block) => {
        if (/^\s*[-*]\s+/m.test(block)) {
            const list = document.createElement('ul');
            block.split('\n').forEach((line) => {
                const itemText = line.replace(/^\s*[-*]\s+/, '').trim();
                if (!itemText) return;
                const item = document.createElement('li');
                appendInlineText(item, itemText);
                list.appendChild(item);
            });
            parent.appendChild(list);
            return;
        }

        const paragraph = document.createElement('p');
        appendInlineText(paragraph, block.replace(/\n/g, ' '));
        parent.appendChild(paragraph);
    });
}

function appendInlineText(parent, text) {
    const inlineCodePattern = /`([^`]+)`/g;
    let lastIndex = 0;
    let match;

    while ((match = inlineCodePattern.exec(text)) !== null) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        const code = document.createElement('code');
        code.textContent = match[1];
        parent.appendChild(code);
        lastIndex = inlineCodePattern.lastIndex;
    }

    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
}

function appendCodeBlock(parent, codeText, language) {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';

    const header = document.createElement('div');
    header.className = 'code-header';

    const label = document.createElement('span');
    label.textContent = language.toLowerCase();

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'copy-code-btn';
    copyButton.textContent = 'Copy';
    copyButton.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(codeText);
            copyButton.textContent = 'Copied';
            setTimeout(() => {
                copyButton.textContent = 'Copy';
            }, 1200);
        } catch (error) {
            copyButton.textContent = 'Failed';
            setTimeout(() => {
                copyButton.textContent = 'Copy';
            }, 1200);
        }
    });

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = `language-${language.toLowerCase()}`;
    code.textContent = codeText;
    pre.appendChild(code);

    header.append(label, copyButton);
    wrapper.append(header, pre);
    parent.appendChild(wrapper);
}

function addLoadingMessage() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message loading';
    messageDiv.id = 'loading-' + Date.now();
    messageDiv.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return messageDiv.id;
}

function removeMessage(id) {
    const element = document.getElementById(id);
    if (element) element.remove();
}

clearBtn.addEventListener('click', async () => {
    if (confirm('Clear all chat history?')) {
        await fetch('/clear', { method: 'POST' });
        chatBox.replaceChildren();
        addMessage('Chat history cleared. Start fresh!', 'system');
    }
});
