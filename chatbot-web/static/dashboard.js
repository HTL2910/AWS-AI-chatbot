let dailyChart = null;

// Load dashboard data on page load
document.addEventListener('DOMContentLoaded', () => {
    loadDashboardData();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('refreshBtn').addEventListener('click', loadDashboardData);
    document.getElementById('exportBtn').addEventListener('click', exportData);
}

async function loadDashboardData() {
    try {
        const response = await fetch('/api/dashboard-stats');
        if (!response.ok) throw new Error('Failed to load dashboard data');
        
        const data = await response.json();
        updateStats(data);
        updateCharts(data);
        updateRecentChats(data);
        updateSystemInfo(data);
        updateLastUpdated();
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showError('Failed to load dashboard data');
    }
}

function updateStats(data) {
    document.getElementById('totalTokens').textContent = data.total_tokens.toLocaleString();
    document.getElementById('totalMessages').textContent = data.total_messages;
    document.getElementById('avgTokens').textContent = data.avg_tokens_per_message;
    
    const statusEl = document.getElementById('apiStatus');
    statusEl.textContent = data.api_status === 'healthy' ? 'Healthy' : 'Offline';
    statusEl.className = data.api_status === 'healthy' ? 'stat-value status-healthy' : 'stat-value status-offline';
}

function updateCharts(data) {
    const ctx = document.getElementById('dailyChart');
    if (!ctx) return;

    const labels = data.daily_data.map(d => d.day);
    const values = data.daily_data.map(d => d.tokens);

    if (dailyChart) {
        dailyChart.data.labels = labels;
        dailyChart.data.datasets[0].data = values;
        dailyChart.update();
    } else {
        dailyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Tokens Used',
                    data: values,
                    backgroundColor: [
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(102, 126, 234, 0.8)',
                        'rgba(102, 126, 234, 0.8)',
                    ],
                    borderColor: 'rgba(102, 126, 234, 1)',
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false,
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: '#6b7280',
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)',
                        }
                    },
                    x: {
                        ticks: {
                            color: '#6b7280',
                        },
                        grid: {
                            display: false,
                        }
                    }
                }
            }
        });
    }
}

function updateRecentChats(data) {
    const chatList = document.getElementById('chatList');
    
    if (!data.recent_chats || data.recent_chats.length === 0) {
        chatList.innerHTML = '<div class="empty-state">No conversations yet</div>';
        return;
    }

    chatList.innerHTML = data.recent_chats.map(chat => `
        <div class="chat-item">
            <div class="chat-item-header">
                <span class="chat-item-user">You</span>
                <span class="chat-item-time">${formatTime(chat.timestamp)}</span>
            </div>
            <div class="chat-item-preview">${escapeHtml(chat.user)}</div>
        </div>
    `).join('');
}

function updateSystemInfo(data) {
    document.getElementById('modelInfo').textContent = data.model || '-';
    document.getElementById('regionInfo').textContent = data.region || '-';
}

function updateLastUpdated() {
    const now = new Date();
    document.getElementById('lastUpdated').textContent = now.toLocaleString();
}

function formatTime(isoString) {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function exportData() {
    alert('Export feature coming soon!');
}

function showError(message) {
    console.error(message);
}
