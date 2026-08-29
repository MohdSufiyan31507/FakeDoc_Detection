document.addEventListener('DOMContentLoaded', () => {
    // Nav Elements
    const navLinks = document.querySelectorAll('.nav-link');
    const views = document.querySelectorAll('.content-area');
    const topBarTitle = document.getElementById('top-bar-title');

    // Dashboard Elements
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const tbody = document.querySelector('#recent-ingestions-table tbody');
    const logTerminal = document.getElementById('log-terminal');
    
    // View Toggling Elements
    const mainSplitPane = document.getElementById('main-split-pane');
    const detailedAnalysis = document.getElementById('detailed-analysis');
    const closeAnalysisBtn = document.getElementById('close-analysis');
    const reportIdSpan = document.getElementById('report-id');

    // Telemetry Elements
    const sysLoadSpan = document.getElementById('sys-load');
    const tickCounterSpan = document.getElementById('tick-counter');
    let tickCount = 0;

    // --- NAVIGATION LOGIC ---
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            views.forEach(view => view.classList.add('hidden'));
            
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');

            topBarTitle.textContent = link.textContent.replace(/\[.*?\]/, '').trim();
            if (targetId === 'dashboard-view') {
                mainSplitPane.classList.remove('hidden');
                detailedAnalysis.classList.add('hidden');
            }
        });
    });

    // --- UPLOAD LOGIC ---
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const fileName = e.target.files[0].name;
            uploadZone.innerHTML = `
                <p>INITIALIZING</p>
                <span class="upload-subtext">${fileName.toUpperCase()}</span>
                <span style="display:block; margin-top:16px; font-weight:bold; color:#0284C7;">[ AWAITING GATE ]</span>
            `;

            setTimeout(() => {
                injectDocument(true);
                uploadZone.innerHTML = `
                    <p>INITIALIZE UPLOAD</p>
                    <span class="upload-subtext">CLICK OR DROP FILE HERE</span>
                    <span style="display:block; margin-top:16px; font-weight:bold; color:#10B981;">[ PREVIOUS PASS ]</span>
                `;
                fileInput.value = '';
            }, 1500);
        }
    });

    // --- LIVE TELEMETRY SIMULATION ---
    
    // 1. Simulate fluctuating CPU Load
    setInterval(() => {
        const baseLoad = 40;
        const variance = (Math.random() * 15) - 5; 
        sysLoadSpan.textContent = (baseLoad + variance).toFixed(1) + '%';
        tickCount++;
        tickCounterSpan.textContent = tickCount;
    }, 1000);

    // 2. Simulate Live Incoming Stream (every 5-10 seconds)
    setInterval(() => {
        // Only inject if Dashboard is active and not currently in Detailed Analysis
        if (!document.getElementById('dashboard-view').classList.contains('hidden') && 
            detailedAnalysis.classList.contains('hidden')) {
            injectDocument(false);
        }
    }, Math.floor(Math.random() * 5000) + 5000); // random interval between 5s and 10s


    function injectDocument(isManual) {
        const isFlagged = Math.random() > 0.6; // 40% chance of being flagged
        const mockId = 'DOC-' + Math.floor(Math.random() * 100000);
        
        const now = new Date();
        const timeString = now.toTimeString().split(' ')[0];
        const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
        const confScore = (Math.random() * 100).toFixed(1) + '%';
        
        const status = isFlagged ? 'QUARANTINE_L1' : 'SYS_CLEARED';
        const source = isManual ? 'MANUAL_OVERRIDE' : 'API_GATEWAY';
        
        const tr = document.createElement('tr');
        tr.classList.add('interactive-row');
        tr.dataset.id = mockId;
        if (isFlagged) tr.classList.add('flagged');
        
        tr.innerHTML = `
            <td>${mockId}</td>
            <td>${timestamp}</td>
            <td>${source}</td>
            <td>${confScore}</td>
            <td>${status}</td>
        `;
        
        tr.addEventListener('click', () => openDetailedAnalysis(mockId));
        
        // Remove oldest row if table gets too long (keep last 10)
        if (tbody.children.length >= 10) {
            tbody.removeChild(tbody.lastChild);
        }
        
        tbody.prepend(tr);

        // Update Audit Log
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<span class="log-time">[${timeString}]</span> <span class="log-sys">SYS_GATE</span>: Event ${mockId} (${source}). CONF: ${confScore}. ROUTE: ${status}`;
        logTerminal.prepend(logEntry);
    }

    // --- DETAILED ANALYSIS LOGIC ---
    closeAnalysisBtn.addEventListener('click', () => {
        detailedAnalysis.classList.add('hidden');
        mainSplitPane.classList.remove('hidden');
    });

    function openDetailedAnalysis(docId) {
        reportIdSpan.textContent = docId;
        mainSplitPane.classList.add('hidden');
        detailedAnalysis.classList.remove('hidden');
    }

    // Populate initial rows
    for(let i=0; i<3; i++) {
        injectDocument(false);
    }
});
