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
        
        const isChairman = chat.faction === 'chairman';
        const iconHTML = isChairman ? '<i class="fa-solid fa-gavel" style="color:#ffd700;"></i>' : '<i class="fa-solid fa-robot"></i>';
        const nameStyle = isChairman ? 'color:#ffd700; font-weight:bold;' : '';
        const bodyStyle = isChairman ? 'border-left: 3px solid #ffd700; padding-left: 10px; font-weight: 500;' : '';
        
        msg.innerHTML = `
            <div class="msg-header" style="${nameStyle}">
                <span>${iconHTML} ${chat.name}</span>
                <span class="time">${chat.time}</span>
            </div>
            <div class="msg-body" style="${bodyStyle}">${chat.text}</div>
        `;
        chatContainer.appendChild(msg);
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function renderScore(key, stats) {
        if(!scores[key]) return;
        const hitRate = stats.total > 0 ? Math.round((stats.hit / stats.total) * 100) : 0;
        const retColor = stats.totalReturn >= 0 ? 'var(--up-color)' : 'var(--down-color)';
        const retSign = stats.totalReturn > 0 ? '+' : '';
        
        const balance = Math.round(stats.balance || 0).toLocaleString();
        const loan = stats.loanAmount > 0 ? `<br><span style="color:#ff4444; font-size:0.85em; display:block; margin-top:4px;">🚨 대출금: -${Math.round(stats.loanAmount).toLocaleString()}₩</span>` : '';
        
        scores[key].innerHTML = `
            <p class="score" style="font-size: 1.25rem; margin-bottom: 6px;">💰 ${balance}₩</p>
            <p class="sub-score" style="line-height:1.4;">🎯 적중률 ${hitRate}% (${stats.hit}/${stats.total})<br>📈 누적수익 <span style="color:${retColor}; font-weight:bold;">${retSign}${stats.totalReturn}%</span>${loan}</p>
        `;
    }

    let globalScores = null;

    socket.on('initData', (data) => {
        globalScores = data.scores;
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
        // Force aggressive scroll to bottom on load
        requestAnimationFrame(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
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

    // Ledger Modal Logic
    const btnLedger = document.getElementById('btnLedger');
    const ledgerModal = document.getElementById('ledgerModal');
    const btnCloseLedger = document.getElementById('btnCloseLedger');
    const ledgerTbody = document.getElementById('ledgerTbody');

    if (btnLedger && ledgerModal) {
        btnLedger.addEventListener('click', () => {
            if(!globalScores) return;
            ledgerTbody.innerHTML = '';
            
            let allRecords = [];
            for(let key of ['chatgpt','gemini','claude']) {
                if(globalScores[key].ledger) {
                    globalScores[key].ledger.forEach(r => {
                        allRecords.push({...r, ai: key});
                    });
                }
            }
            allRecords.sort((a,b) => new Date(b.date) - new Date(a.date));
            
            allRecords.forEach(r => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
                const isProfit = r.profitAmount >= 0;
                const color = isProfit ? 'var(--up-color)' : 'var(--down-color)';
                const aiName = r.ai === 'chatgpt' ? 'ChatGPT' : (r.ai === 'gemini' ? 'Gemini' : 'Claude');
                
                tr.innerHTML = `
                    <td style="padding:12px 10px;">${r.date}</td>
                    <td style="padding:12px 10px; font-weight:bold;" class="${r.ai}-text">${aiName}</td>
                    <td style="padding:12px 10px;">${r.stockName}(${r.symbol})</td>
                    <td style="padding:12px 10px;">${r.buyActual}</td>
                    <td style="padding:12px 10px;">${r.sellActual}</td>
                    <td style="padding:12px 10px; color:${color}; font-weight:bold;">${Math.round(r.profitAmount).toLocaleString()}₩</td>
                    <td style="padding:12px 10px; color:${color};">${r.profitPercent}%</td>
                    <td style="padding:12px 10px;">${r.hit ? '✅ 목표달성' : (isProfit ? '💰 익절청산' : '💀 손실청산')}</td>
                `;
                ledgerTbody.appendChild(tr);
            });
            
            if(allRecords.length === 0) {
                ledgerTbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:20px;">아직 거래 장부가 없습니다.</td></tr>';
            }
            ledgerModal.style.display = 'flex';
        });
        
        btnCloseLedger.addEventListener('click', () => {
            ledgerModal.style.display = 'none';
        });
    }
});
