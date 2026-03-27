document.addEventListener('DOMContentLoaded', () => {
    const chatContainer = document.getElementById('chatContainer');
    const socket = io();

    // DOM Elements for Scoreboard & Picks
    const scores = {
        chatgpt: document.querySelector('.chatgpt-score'),
        gemini: document.querySelector('.gemini-score'),
        claude: document.querySelector('.claude-score')
    };

    const picksBoxes = {
        chatgpt: document.querySelectorAll('.ticker-box')[0],
        gemini: document.querySelectorAll('.ticker-box')[1],
        claude: document.querySelectorAll('.ticker-box')[2]
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

    function renderPicks(picks) {
        for(let key in picks) {
            const p = picks[key];
            const box = picksBoxes[key];
            if(!box) continue;
            
            let newsHref = "#";
            if(p.symbol && p.symbol.endsWith('.KS')) newsHref = `https://finance.naver.com/item/news.naver?code=${p.symbol.replace('.KS', '')}`;
            else newsHref = `https://finance.yahoo.com/quote/${p.symbol}/news`;
            const newsHtml = p.symbol ? `<a href="${newsHref}" target="_blank" style="display: block; margin-top: 15px; color: var(--color-${key}); font-size: 0.85rem; text-decoration: none; font-weight: bold; background: rgba(255,255,255,0.05); padding: 8px; border-radius: 6px; text-align: center; transition: 0.2s;"><i class="fa-solid fa-newspaper"></i> 관련 핵심 뉴스 보기</a>` : '';
            
            let contentHTML = '';
            
            if (p.status === '대기중') {
                contentHTML = `
                    <div class="ticker-header ${key}-text">${key.toUpperCase()} Pick</div>
                    <div style="text-align:center; padding: 5px; margin-bottom: 10px; background:#444; border-radius:4px; font-size:0.85rem; font-weight:bold; color:#ccc;">⏳ 개장/체결 대기중</div>
                    <div class="stock-info" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="stock-name" style="font-size: 1.2rem; font-weight:bold;">${p.stockName} <span style="font-size:0.9rem;color:#888;font-weight:normal;">(${p.symbol})</span></span>
                    </div>
                    <div class="stock-targets" style="display:flex; justify-content:space-between; margin-top:15px; margin-bottom:15px;">
                        <div class="target buy" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; width:48%; text-align:center;">
                            <span style="display:block; font-size:0.8rem; color:#aaa; margin-bottom:5px;">AI 픽: 예측 시작가</span>
                            <strong style="font-size:1.1rem; color:#fff;">${p.buyPrice}</strong>
                        </div>
                        <div class="target sell" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; width:48%; text-align:center;">
                            <span style="display:block; font-size:0.8rem; color:#aaa; margin-bottom:5px;">목표 매도가</span>
                            <strong style="font-size:1.1rem; color:#fff;">${p.sellPrice}</strong>
                        </div>
                    </div>
                    <div class="stock-reason" style="font-size:0.9rem; line-height:1.4; color:#bbb; border-left: 3px solid #666; padding-left:10px;">💡 핵심 사유: "${p.reason || ''}"</div>
                    ${newsHtml}
                `;
            } else if (p.status === '진행중') {
                contentHTML = `
                    <div class="ticker-header ${key}-text">${key.toUpperCase()} Pick</div>
                    <div style="text-align:center; padding: 5px; margin-bottom: 10px; background:rgba(0, 229, 255, 0.1); color:#00e5ff; border: 1px solid rgba(0,229,255,0.3); border-radius:4px; font-size:0.85rem; font-weight:bold; animation: pulse 2s infinite;">🔥 실시간 매매 진행중</div>
                    <div class="stock-info" style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="stock-name" style="font-size: 1.2rem; font-weight:bold;">${p.stockName} <span style="font-size:0.9rem;color:#888;font-weight:normal;">(${p.symbol})</span></span>
                        <span class="stock-price ${p.change.startsWith('-') ? 'down' : 'up'}" style="font-weight:bold; font-size:1.1rem;">${p.currentPrice} (${p.change})</span>
                    </div>
                    <div class="stock-targets" style="display:flex; justify-content:space-between; margin-top:15px; margin-bottom:15px;">
                        <div class="target buy" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; width:48%; text-align:center;">
                            <span style="display:block; font-size:0.8rem; color:#aaa; margin-bottom:5px;">체결된 실제 시작가</span>
                            <strong style="font-size:1.1rem; color:#fff;">${Number(p.buyPriceRaw).toLocaleString()}</strong>
                        </div>
                        <div class="target sell" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; width:48%; text-align:center;">
                            <span style="display:block; font-size:0.8rem; color:#aaa; margin-bottom:5px;">목표 매도가</span>
                            <strong style="font-size:1.1rem; color:#fff;">${p.sellPrice}</strong>
                        </div>
                    </div>
                    <div class="stock-reason" style="font-size:0.9rem; line-height:1.4; color:#bbb; border-left: 3px solid #666; padding-left:10px;">💡 핵심 사유: "${p.reason || ''}"</div>
                    ${newsHtml}
                `;
            } else if (p.status === '마감') {
                const isProfit = Number(p.finalProfitAmt) >= 0;
                const pColor = isProfit ? 'var(--up-color)' : 'var(--down-color)';
                const sign = isProfit ? '+' : '';
                contentHTML = `
                    <div class="ticker-header ${key}-text">${key.toUpperCase()} Result</div>
                    <div style="text-align:center; padding: 5px; margin-bottom: 10px; background:#2a2a3e; border: 1px solid #445; color:#a8d5ff; border-radius:4px; font-size:0.85rem; font-weight:bold;">🏁 장 마감 결과 및 정산</div>
                    <div class="stock-info" style="text-align:center; padding-bottom:10px; border-bottom: 1px solid #333;">
                        <span class="stock-name" style="font-size: 1.3rem; font-weight:bold;">${p.stockName} <span style="font-size:0.9rem;color:#888;font-weight:normal;">(${p.symbol})</span></span>
                    </div>
                    <div style="margin: 15px 0; background:rgba(0,0,0,0.3); padding:15px; border-radius:8px; text-align:center;">
                        <div style="font-size:1.4rem; font-weight:bold; color:${pColor};">${sign}${Math.round(p.finalProfitAmt).toLocaleString()}₩</div>
                        <div style="font-size:1rem; font-weight:bold; color:${pColor}; margin-top:5px;">${sign}${p.finalProfitPercent}%</div>
                        <div style="font-size:0.9rem; color:#ccc; margin-top:8px;">${p.achieved ? '✅ 목표도달 조기익절' : (isProfit ? '💰 종가 기준 익절청산' : '💀 종가 기준 손실청산')}</div>
                    </div>
                    <div class="stock-lesson" style="font-size: 0.9rem; color:#a8d5ff; line-height: 1.4; border-left: 3px solid #00a3ff; padding-left: 10px; background: rgba(0,163,255,0.05); padding: 10px; border-radius: 6px;">
                        <strong>🔍 AI 결과 분석:</strong><br>${p.lessonLearned || '분석 중...'}
                    </div>
                `;
            } else {
                contentHTML = `<div style="padding: 20px; text-align: center; color: #888;">데이터 대기 중...</div>`;
            }
            
            box.innerHTML = contentHTML;
        }
    }

    let globalScores = null;

    socket.on('initData', (data) => {
        globalScores = data.scores;
        // Update scores
        for(let key in data.scores) {
            renderScore(key, data.scores[key]);
        }
        
        renderPicks(data.picks);

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
        // No longer used, but kept for fallback compatibility
    });

    socket.on('updatePrices', (livePicks) => {
        renderPicks(livePicks);
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
                
                const reasonHtml = r.reason ? `<div style="margin-top: 8px; font-size: 0.8rem; color: #aaa; line-height: 1.3; font-weight: normal;"><i class="fa-solid fa-lightbulb" style="color:#ffd700;"></i> <b>추천사유:</b> ${r.reason}</div>` : '';
                const lessonHtml = r.lessonLearned ? `<div style="margin-top: 4px; font-size: 0.8rem; color: #a8d5ff; line-height: 1.3; font-weight: normal;"><i class="fa-solid fa-magnifying-glass-chart" style="color:#00a3ff;"></i> <b>결과분석:</b> ${r.lessonLearned}</div>` : '';
                
                tr.innerHTML = `
                    <td style="padding:12px 10px; vertical-align: top;">${r.date}</td>
                    <td style="padding:12px 10px; font-weight:bold; vertical-align: top;" class="${r.ai}-text">${aiName}</td>
                    <td style="padding:12px 10px; min-width: 300px; vertical-align: top;">
                        <span style="font-weight:bold; font-size: 1.05rem;">${r.stockName}</span> <span style="font-size: 0.85rem; color: #888;">(${r.symbol})</span>
                        ${reasonHtml}
                        ${lessonHtml}
                    </td>
                    <td style="padding:12px 10px; vertical-align: top;">${Number(r.buyActual).toLocaleString()}</td>
                    <td style="padding:12px 10px; vertical-align: top;">${Number(r.sellActual).toLocaleString()}</td>
                    <td style="padding:12px 10px; color:${color}; font-weight:bold; vertical-align: top;">${Math.round(r.profitAmount).toLocaleString()}₩</td>
                    <td style="padding:12px 10px; color:${color}; vertical-align: top;">${r.profitPercent}%</td>
                    <td style="padding:12px 10px; vertical-align: top;">${r.hit ? '✅ 목표달성' : (isProfit ? '💰 종가익절' : '💀 종가손실')}</td>
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

    // --- Market Status Dynamic Countdown ---
    function updateMarketStatus() {
        const container = document.getElementById('marketStatusContainer');
        if (!container) return;

        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();

        const isKROpen = (h > 9 || (h === 9 && m >= 0)) && (h < 15 || (h === 15 && m < 30));
        const isUSOpen = (h === 23 && m >= 30) || (h < 5);

        let statusHtml = '';

        function formatTimeLeft(targetH, targetM) {
            let targetDate = new Date(now);
            targetDate.setHours(targetH, targetM, 0, 0);
            if (now >= targetDate) {
                targetDate.setDate(targetDate.getDate() + 1);
            }
            const diffMs = targetDate - now;
            const diffH = Math.floor(diffMs / (1000 * 60 * 60));
            const diffM = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            const diffS = Math.floor((diffMs % (1000 * 60)) / 1000);
            return `${String(diffH).padStart(2, '0')}:${String(diffM).padStart(2, '0')}:${String(diffS).padStart(2, '0')}`;
        }

        if (isKROpen || isUSOpen) {
            const isKR = isKROpen;
            const marketName = isKR ? '국내장' : '해외장';
            const closeH = isKR ? 15 : 5;
            const closeM = isKR ? 30 : 0;
            const timeLeft = formatTimeLeft(closeH, closeM);
            statusHtml = `<span class="badge badge-active"><i class="fa-solid fa-fire"></i> ${marketName} 투자 진행중 : ${timeLeft}</span>`;
        } else {
            let nextH, nextM, marketName;
            if (h >= 5 && h < 9) {
                nextH = 9; nextM = 0; marketName = '국내장';
            } else {
                nextH = 23; nextM = 30; marketName = '해외장';
            }
            const timeLeft = formatTimeLeft(nextH, nextM);
            // user request: "현재 준비중 : 남은시간 타이머"
            statusHtml = `<span class="badge badge-sleep"><i class="fa-solid fa-mug-hot"></i> ${marketName} 현재 준비중 : ${timeLeft}</span>`;
        }
        
        container.innerHTML = statusHtml;
    }

    setInterval(updateMarketStatus, 1000);
    updateMarketStatus();
});
