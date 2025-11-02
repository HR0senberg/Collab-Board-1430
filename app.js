// Application State
const appState = {
    currentScreen: 'welcome',
    myUserId: null,
    myRoomCode: null,
    isInitiator: false,
    channel: null,
    messages: [],
    connectionStatus: 'disconnected',
    connectedPeers: new Set(),
    heartbeatInterval: null
};

// Generate unique user ID
function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// DOM Elements
const screens = {
    welcome: document.getElementById('welcomeScreen'),
    roomCreated: document.getElementById('roomCreatedScreen'),
    chat: document.getElementById('chatScreen')
};

const elements = {
    // Welcome screen
    createRoomBtn: document.getElementById('createRoomBtn'),
    joinRoomBtn: document.getElementById('joinRoomBtn'),
    roomCodeInput: document.getElementById('roomCodeInput'),
    errorMessage: document.getElementById('errorMessage'),
    
    // Room created screen
    displayRoomCode: document.getElementById('displayRoomCode'),
    copyCodeBtn: document.getElementById('copyCodeBtn'),
    myPeerIdDisplay: document.getElementById('myPeerIdDisplay'),
    
    // Chat screen
    chatRoomCode: document.getElementById('chatRoomCode'),
    connectionStatus: document.getElementById('connectionStatus'),
    messagesContainer: document.getElementById('messagesContainer'),
    messageInput: document.getElementById('messageInput'),
    sendMessageBtn: document.getElementById('sendMessageBtn'),
    leaveRoomBtn: document.getElementById('leaveRoomBtn')
};

// In-memory room storage (shared across tabs via BroadcastChannel)
const roomRegistry = {};

// Room Management with in-memory storage
function saveRoomToMemory(roomCode, userId) {
    if (!roomRegistry[roomCode]) {
        roomRegistry[roomCode] = {
            created: Date.now(),
            users: []
        };
    }
    if (!roomRegistry[roomCode].users.includes(userId)) {
        roomRegistry[roomCode].users.push(userId);
    }
}

function removeUserFromRoom(roomCode, userId) {
    if (roomRegistry[roomCode]) {
        roomRegistry[roomCode].users = roomRegistry[roomCode].users.filter(u => u !== userId);
        if (roomRegistry[roomCode].users.length === 0) {
            delete roomRegistry[roomCode];
        }
    }
}

function checkRoomExists(roomCode) {
    // Room exists if it's in memory OR if we get a response via BroadcastChannel
    return roomRegistry[roomCode] && roomRegistry[roomCode].users.length > 0;
}

// Utility Functions
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function validateRoomCode(code) {
    return /^[A-Z0-9]{6}$/.test(code);
}

function showScreen(screenName) {
    Object.keys(screens).forEach(key => {
        screens[key].classList.remove('active');
    });
    screens[screenName].classList.add('active');
    appState.currentScreen = screenName;
}

function showError(message) {
    elements.errorMessage.textContent = message;
    setTimeout(() => {
        elements.errorMessage.textContent = '';
    }, 3000);
}

function formatTime(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Message Functions
function addMessage(type, text, timestamp = new Date()) {
    const message = { type, text, timestamp };
    appState.messages.push(message);
    displayMessage(message);
}

function displayMessage(message) {
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${message.type}`;
    
    const textEl = document.createElement('div');
    textEl.textContent = message.text;
    messageEl.appendChild(textEl);
    
    if (message.type !== 'system') {
        const timeEl = document.createElement('span');
        timeEl.className = 'message-timestamp';
        timeEl.textContent = formatTime(message.timestamp);
        messageEl.appendChild(timeEl);
    }
    
    elements.messagesContainer.appendChild(messageEl);
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

function sendMessage() {
    const text = elements.messageInput.value.trim();
    if (!text) return;
    
    if (appState.channel) {
        sendBroadcastMessage({
            type: 'message',
            userId: appState.myUserId,
            text: text,
            timestamp: new Date().toISOString()
        });
        
        addMessage('own', text);
        elements.messageInput.value = '';
    } else {
        showError('Нет подключения');
    }
}

// Connection Status
function updateConnectionStatus(status) {
    appState.connectionStatus = status;
    const statusEl = elements.connectionStatus;
    
    statusEl.classList.remove('connected', 'disconnected');
    
    if (status === 'connected') {
        statusEl.classList.add('connected');
        statusEl.querySelector('.status-text').textContent = 'Подключено';
    } else if (status === 'disconnected') {
        statusEl.classList.add('disconnected');
        statusEl.querySelector('.status-text').textContent = 'Отключено';
    } else {
        statusEl.querySelector('.status-text').textContent = 'Подключение...';
    }
}

// BroadcastChannel Functions
function initializeBroadcastChannel(roomCode) {
    const channelName = 'p2p-chat-' + roomCode;
    
    try {
        const channel = new BroadcastChannel(channelName);
        
        channel.onmessage = (event) => {
            handleBroadcastMessage(event.data);
        };
        
        channel.onerror = (error) => {
            console.error('BroadcastChannel error:', error);
        };
        
        appState.channel = channel;
        console.log('BroadcastChannel initialized:', channelName);
        
        // Announce presence
        setTimeout(() => {
            sendBroadcastMessage({
                type: 'join',
                userId: appState.myUserId,
                timestamp: Date.now()
            });
        }, 100);
        
        // Start heartbeat
        startHeartbeat();
        
        return channel;
    } catch (error) {
        console.error('BroadcastChannel not supported:', error);
        showError('Ваш браузер не поддерживает многовкладочную связь');
        return null;
    }
}

function sendBroadcastMessage(data) {
    if (appState.channel) {
        try {
            appState.channel.postMessage(data);
        } catch (error) {
            console.error('Failed to send message:', error);
        }
    }
}

function handleBroadcastMessage(data) {
    console.log('Received broadcast:', data);
    
    switch (data.type) {
        case 'join':
            if (data.userId !== appState.myUserId) {
                appState.connectedPeers.add(data.userId);
                addMessage('system', 'Пользователь подключился');
                updateConnectionStatus('connected');
                
                // Respond with our presence
                sendBroadcastMessage({
                    type: 'join-response',
                    userId: appState.myUserId,
                    timestamp: Date.now()
                });
                
                // Move to chat if still waiting
                if (appState.currentScreen === 'roomCreated') {
                    showScreen('chat');
                    elements.chatRoomCode.textContent = appState.myRoomCode;
                }
            }
            break;
            
        case 'join-response':
            if (data.userId !== appState.myUserId) {
                appState.connectedPeers.add(data.userId);
                updateConnectionStatus('connected');
            }
            break;
            
        case 'message':
            if (data.userId !== appState.myUserId) {
                addMessage('other', data.text, new Date(data.timestamp));
            }
            break;
            
        case 'leave':
            if (data.userId !== appState.myUserId) {
                appState.connectedPeers.delete(data.userId);
                addMessage('system', 'Пользователь отключился');
                
                if (appState.connectedPeers.size === 0) {
                    updateConnectionStatus('disconnected');
                }
            }
            break;
            
        case 'heartbeat':
            if (data.userId !== appState.myUserId) {
                appState.connectedPeers.add(data.userId);
                if (appState.connectionStatus !== 'connected') {
                    updateConnectionStatus('connected');
                }
            }
            break;
    }
}

function startHeartbeat() {
    if (appState.heartbeatInterval) {
        clearInterval(appState.heartbeatInterval);
    }
    
    appState.heartbeatInterval = setInterval(() => {
        sendBroadcastMessage({
            type: 'heartbeat',
            userId: appState.myUserId,
            timestamp: Date.now()
        });
    }, 3000);
}

function stopHeartbeat() {
    if (appState.heartbeatInterval) {
        clearInterval(appState.heartbeatInterval);
        appState.heartbeatInterval = null;
    }
}



// Room Creation
function createRoom() {
    try {
        const roomCode = generateRoomCode();
        appState.myRoomCode = roomCode;
        appState.isInitiator = true;
        appState.myUserId = generateUserId();
        
        // Save room to memory
        saveRoomToMemory(roomCode, appState.myUserId);
        
        // Initialize BroadcastChannel
        initializeBroadcastChannel(roomCode);
        
        // Display room code
        elements.displayRoomCode.textContent = roomCode;
        
        showScreen('roomCreated');
        
        console.log('Room created:', roomCode, 'User ID:', appState.myUserId);
    } catch (error) {
        console.error('Error creating room:', error);
        showError('Ошибка создания комнаты');
    }
}

// Room Joining
function joinRoom() {
    const roomCode = elements.roomCodeInput.value.trim().toUpperCase();
    
    if (!validateRoomCode(roomCode)) {
        showError('Пожалуйста, введите правильный код (6 символов)');
        return;
    }
    
    try {
        // Check if room exists
        if (!checkRoomExists(roomCode)) {
            showError('Комната не найдена. Убедитесь, что код правильный и комната открыта в другой вкладке.');
            return;
        }
        
        appState.myRoomCode = roomCode;
        appState.isInitiator = false;
        appState.myUserId = generateUserId();
        
        // Save to memory
        saveRoomToMemory(roomCode, appState.myUserId);
        
        // Initialize BroadcastChannel
        initializeBroadcastChannel(roomCode);
        
        // Go to chat screen
        showScreen('chat');
        elements.chatRoomCode.textContent = roomCode;
        addMessage('system', 'Присоединились к комнате');
        updateConnectionStatus('connecting');
        
        console.log('Joined room:', roomCode, 'User ID:', appState.myUserId);
        
    } catch (error) {
        console.error('Error joining room:', error);
        showError('Ошибка подключения к комнате');
    }
}

// Leave Room
function leaveRoom() {
    // Send leave message
    if (appState.channel) {
        sendBroadcastMessage({
            type: 'leave',
            userId: appState.myUserId,
            timestamp: Date.now()
        });
        
        appState.channel.close();
    }
    
    // Stop heartbeat
    stopHeartbeat();
    
    // Clean up storage
    if (appState.myRoomCode && appState.myUserId) {
        removeUserFromRoom(appState.myRoomCode, appState.myUserId);
    }
    
    // Reset state
    appState.myUserId = null;
    appState.myRoomCode = null;
    appState.isInitiator = false;
    appState.channel = null;
    appState.messages = [];
    appState.connectionStatus = 'disconnected';
    appState.connectedPeers.clear();
    
    // Clear UI
    elements.messagesContainer.innerHTML = '';
    elements.roomCodeInput.value = '';
    elements.messageInput.value = '';
    
    showScreen('welcome');
}

// Event Listeners
elements.createRoomBtn.addEventListener('click', createRoom);

elements.joinRoomBtn.addEventListener('click', joinRoom);

elements.roomCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        joinRoom();
    }
});

elements.copyCodeBtn.addEventListener('click', async () => {
    const code = elements.displayRoomCode.textContent;
    try {
        await navigator.clipboard.writeText(code);
        elements.copyCodeBtn.textContent = '✅ Скопировано!';
        setTimeout(() => {
            elements.copyCodeBtn.textContent = '📋 Скопировать';
        }, 2000);
    } catch (error) {
        console.error('Failed to copy:', error);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = code;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            elements.copyCodeBtn.textContent = '✅ Скопировано!';
            setTimeout(() => {
                elements.copyCodeBtn.textContent = '📋 Скопировать';
            }, 2000);
        } catch (err) {
            showError('Не удалось скопировать');
        }
        document.body.removeChild(textArea);
    }
});



elements.sendMessageBtn.addEventListener('click', sendMessage);

elements.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

elements.leaveRoomBtn.addEventListener('click', () => {
    if (confirm('Вы уверены, что хотите покинуть комнату?')) {
        leaveRoom();
    }
});



// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (appState.channel) {
        try {
            sendBroadcastMessage({
                type: 'leave',
                userId: appState.myUserId,
                timestamp: Date.now()
            });
        } catch (e) {
            console.log('Channel already closed');
        }
    }
    
    if (appState.myRoomCode && appState.myUserId) {
        removeUserFromRoom(appState.myRoomCode, appState.myUserId);
    }
});

// Initialize
console.log('P2P Chat Application loaded');
console.log('Using BroadcastChannel for multi-tab communication');
console.log('Ready to create or join rooms');