document.addEventListener('DOMContentLoaded', () => {
    const chatContainer = document.getElementById('chatContainer');
    const socket = io();

    // DOM Elements for Scoreboard & Picks
    const scores = {
        chatgpt: document.querySelector('.chatgpt-score'),
        gemini: document.querySelector('.gemini-score'),
        claude: document.querySelector('.claude-score')
    };

    const picks = {
        chatgpt: {
            name: document.querySelector('.chatgpt-text').nextElementSibling.querySelector('.stock-name'),
            price: document.querySelector('.chatgpt-text').nextElementSibling.querySelector('.stock-price'),
            buyPrice: document.querySelector('.chatgpt-text').parentNode.querySelector('.buy-price'),
            sellPrice: document.querySelector('.chatgpt-text').parentNode.querySelector('.sell-price'),
            reason: document.querySelector('.chatgpt-text').parentNode.querySelector('.stock-reason'),
            newsLink: document.querySelector('.chatgpt-text').parentNode.querySelector('.news-link')
        },
        gemini: {
            name: document.querySelector('.gemini-text').nextElementSibling.querySelector('.stock-name'),
            price: document.querySelector('.gemini-text').nextElementSibling.querySelector('.stock-price'),
            buyPrice: document.querySelector('.gemini-text').parentNode.querySelector('.buy-price'),
            sellPrice: document.querySelector('.gemini-text').parentNode.querySelector('.sell-price'),
            reason: document.querySelector('.gemini-text').parentNode.querySelector('.stock-reason'),
            newsLink: document.querySelector('.gemini-text').parentNode.querySelector('.news-link')
        },
        claude: {
            name: document.querySelector('.claude-text').nextElementSibling.querySelector('.stock-name'),
            price: document.querySelector('.claude-text').nextElementSibling.querySelector('.stock-price'),
            buyPrice: document.querySelector('.claude-text').parentNode.querySelector('.buy-price'),
            sellPrice: document.querySelector('.claude-text').parentNode.querySelector('.sell-price'),
            reason: document.querySelector('.claude-text').parentNode.querySelector('.stock-reason'),
            newsLink: document.querySelector('.claude-text').parentNode.querySelector('.news-link')
        }
    };
    
    function addMessage(chat) {
        const msg = document.createElement('div');
        msg.className = `message ${chat.faction}`;
        msg.innerHTML = `
            <div class="msg-header">
                <span><i class="fa-solid fa-robot"></i> ${chat.name}</span>
                <span class="time">${chat.time}</span>
            </div>
            <div class="msg-body">${chat.text}</div>
        `;
        chatContainer.appendChild(msg);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function renderScore(key, stats) {
        if(!scores[key]) return;
        const hitRate = stats.total > 0 ? Math.round((stats.hit / stats.total) * 100) : 0;
        const retColor = stats.totalReturn >= 0 ? 'var(--up-color)' : 'var(--down-color)';
        const retSign = stats.totalReturn > 0 ? '+' : '';
        scores[key].innerHTML = `
            <p class="score">🎯 적중률 ${hitRate}%</p>
            <p class="sub-score">목표달성 ${stats.hit}회 / 누적 수익 <span style="color:${retColor}">${retSign}${stats.totalReturn}%</span></p>
        `;
    }

    socket.on('initData', (data) => {
        // Update scores
        for(let key in data.scores) {
            renderScore(key, data.scores[key]);
        }
        
        // Update picks
        for(let key in data.picks) {
            if(picks[key] && data.picks[key].stockName) {
                picks[key].name.textContent = data.picks[key].stockName;
                picks[key].price.textContent = `${data.picks[key].currentPrice} (${data.picks[key].change})`;
                picks[key].price.className = `stock-price ${data.picks[key].change.startsWith('-') ? 'down' : 'up'}`;
                if(data.picks[key].buyPrice) picks[key].buyPrice.textContent = data.picks[key].buyPrice;
                if(data.picks[key].sellPrice) picks[key].sellPrice.textContent = data.picks[key].sellPrice;
                if(data.picks[key].reason) picks[key].reason.textContent = `이유: "${data.picks[key].reason}"`;
                if(data.picks[key].newsLink && data.picks[key].newsLink.startsWith('http')) {
                    picks[key].newsLink.href = data.picks[key].newsLink;
                    picks[key].newsLink.style.display = 'block';
                } else {
                    picks[key].newsLink.style.display = 'none';
                }
            }
        }

        // Render history
        chatContainer.innerHTML = '';
        data.chatHistory.forEach(chat => addMessage(chat));
    });

    socket.on('newChat', (chat) => {
        addMessage(chat);
    });

    socket.on('updateScore', (data) => {
        renderScore(data.faction, data.stats);
    });

    socket.on('updatePick', (data) => {
        if(picks[data.faction]) {
            picks[data.faction].name.textContent = data.stockName;
            picks[data.faction].price.textContent = `${data.currentPrice} (${data.change})`;
            picks[data.faction].price.className = `stock-price ${data.change.startsWith('-') ? 'down' : 'up'}`;
            if(data.buyPrice) picks[data.faction].buyPrice.textContent = data.buyPrice;
            if(data.sellPrice) picks[data.faction].sellPrice.textContent = data.sellPrice;
            if(data.reason) picks[data.faction].reason.textContent = `이유: "${data.reason}"`;
        }
    });

    // Random visual fluctuation for un-updated sockets
    setInterval(() => {
        document.querySelectorAll('.stock-price').forEach(el => {
            if(Math.random() > 0.6) {
                const isUp = Math.random() > 0.5;
                el.classList.toggle('up', isUp);
                el.classList.toggle('down', !isUp);
            }
        });
    }, 2000);
});
