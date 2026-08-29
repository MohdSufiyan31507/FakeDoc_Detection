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
    const forensicImageContainer = document.getElementById('forensic-image-container');
    const ocrTable = document.getElementById('ocr-table');
    const extractedFaceBox = document.getElementById('extracted-face-box');

    // Telemetry Elements
    const sysLoadSpan = document.getElementById('sys-load');
    const tickCounterSpan = document.getElementById('tick-counter');
    let tickCount = 0;

    const analysisStore = {};

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

    // --- MILESTONE 10: REAL DATABASE FETCHING ---
    async function refreshData() {
        try {
            // Fetch Stream
            const streamRes = await fetch('http://localhost:8000/api/stream');
            if(streamRes.ok) {
                const streamData = await streamRes.json();
                tbody.innerHTML = '';
                streamData.documents.forEach(doc => {
                    const tr = document.createElement('tr');
                    tr.classList.add('interactive-row');
                    tr.dataset.id = doc.doc_id;
                    if (doc.is_flagged) tr.classList.add('flagged');
                    
                    let srcColor = doc.source_type === 'REAL_UPLOAD' ? 'color:#3B82F6; font-weight:bold;' : '';
                    
                    tr.innerHTML = `
                        <td>${doc.doc_id}</td>
                        <td>${doc.timestamp}</td>
                        <td style="${srcColor}">${doc.source_type}</td>
                        <td>${doc.confidence}</td>
                        <td>${doc.decision}</td>
                    `;
                    // If it's real upload, it relies on analysisStore.
                    // (For a full app, we'd store the image in DB, but for prototype we just use local store for current session real uploads)
                    tr.addEventListener('click', () => openDetailedAnalysis(doc.doc_id, doc.source_type === 'REAL_UPLOAD'));
                    tbody.appendChild(tr);
                });
            }

            // Fetch Audit
            const auditRes = await fetch('http://localhost:8000/api/audit');
            if(auditRes.ok) {
                const auditData = await auditRes.json();
                logTerminal.innerHTML = '';
                auditData.logs.forEach(log => {
                    const logEntry = document.createElement('div');
                    logEntry.className = 'log-entry';
                    const actorClass = log.actor === 'PYTHON_BACKEND' ? 'log-user' : 'log-sys';
                    logEntry.innerHTML = `<span class="log-time">[${log.time_str}]</span> <span class="${actorClass}">${log.actor}</span>: ${log.action}`;
                    logTerminal.appendChild(logEntry);
                });
            }
        } catch (err) {
            console.error("DB Fetch Error (Is backend running?):", err);
        }
    }

    // Load data on startup
    refreshData();


    // --- REAL BACKEND UPLOAD LOGIC ---
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            
            uploadZone.innerHTML = `
                <p>UPLOADING TO BACKEND</p>
                <span class="upload-subtext">${file.name.toUpperCase()}</span>
                <span style="display:block; margin-top:16px; font-weight:bold; color:#0284C7;">[ AI PROCESSING ]</span>
            `;

            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('http://localhost:8000/api/analyze', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                if (data.status === 'success') {
                    analysisStore[data.doc_id] = data;
                    
                    // Refresh data from the DB to show the new record
                    await refreshData();

                    uploadZone.innerHTML = `
                        <p>INITIALIZE UPLOAD</p>
                        <span class="upload-subtext">CLICK OR DROP FILE HERE</span>
                        <span style="display:block; margin-top:16px; font-weight:bold; color:#10B981;">[ ANALYSIS COMPLETE ]</span>
                    `;
                } else {
                    uploadZone.innerHTML = `
                        <p>SYSTEM ERROR</p>
                        <span class="upload-subtext">BACKEND FAILED</span>
                        <span style="display:block; margin-top:16px; font-weight:bold; color:#EF4444;">[ ${data.message || 'Check Server'} ]</span>
                    `;
                }
            } catch (err) {
                console.error(err);
                uploadZone.innerHTML = `
                    <p>CONNECTION REFUSED</p>
                    <span class="upload-subtext">IS THE PYTHON BACKEND RUNNING?</span>
                    <span style="display:block; margin-top:16px; font-weight:bold; color:#EF4444;">[ RUN: uvicorn main:app --reload ]</span>
                `;
            }
            fileInput.value = '';
        }
    });

    // --- LIVE TELEMETRY SIMULATION ---
    setInterval(() => {
        const baseLoad = 40;
        const variance = (Math.random() * 15) - 5; 
        sysLoadSpan.textContent = (baseLoad + variance).toFixed(1) + '%';
        tickCount++;
        tickCounterSpan.textContent = tickCount;
    }, 1000);

    // Call backend to simulate an API Gateway ingestion
    setInterval(async () => {
        if (!document.getElementById('dashboard-view').classList.contains('hidden') && 
            detailedAnalysis.classList.contains('hidden')) {
            try {
                await fetch('http://localhost:8000/api/simulate_gateway', { method: 'POST' });
                refreshData(); // Refresh DB view
            } catch(err) { /* backend offline */ }
        }
    }, 8000); 

    // --- DETAILED ANALYSIS LOGIC ---
    closeAnalysisBtn.addEventListener('click', () => {
        detailedAnalysis.classList.add('hidden');
        mainSplitPane.classList.remove('hidden');
    });

    function openDetailedAnalysis(docId, isReal = false) {
        reportIdSpan.textContent = docId;
        
        if (isReal && analysisStore[docId]) {
            const data = analysisStore[docId];
            forensicImageContainer.innerHTML = `
                <img src="${data.ela_heatmap}" style="max-width:100%; max-height:100%; object-fit:contain; border: 1px solid #94A3B8;">
            `;
            
            let tableHTML = '';
            const mrzStatus = data.metadata_checks?.mrz || 'NOT_FOUND';
            const mrzDetails = data.metadata_checks?.mrz_details || '';
            let statusColor = mrzStatus === 'PASS' ? 'status-ok' : (mrzStatus === 'FAIL' ? 'alert-text' : 'status-ok');
            
            tableHTML += `<tr>
                <td style="color:#3B82F6;">SYS_MRZ_CHECKSUM</td>
                <td style="font-weight:bold; color:#0F172A;">${mrzDetails}</td>
                <td class="${statusColor}">${mrzStatus}</td>
            </tr>`;
            
            if (data.extracted_text && data.extracted_text.length > 0) {
                tableHTML += data.extracted_text.map((text, idx) => `
                    <tr><td>STRING_${idx.toString().padStart(3, '0')}</td><td style="color:#64748B;">${text}</td><td class="status-ok">EXTRACTED</td></tr>
                `).join('');
            } else {
                tableHTML += `<tr><td colspan="3" class="alert-text">NO TEXT DETECTED IN DOCUMENT</td></tr>`;
            }
            ocrTable.innerHTML = tableHTML;

            if (data.extracted_face) {
                extractedFaceBox.innerHTML = `<img src="${data.extracted_face}" style="max-width:100%; max-height:100%; object-fit:cover;">`;
                extractedFaceBox.style.padding = '0';
            } else {
                extractedFaceBox.innerHTML = `NO FACE<br>DETECTED`;
                extractedFaceBox.style.padding = ''; 
                extractedFaceBox.style.color = '#EF4444'; 
            }

        } else {
            forensicImageContainer.innerHTML = `
                <div class="id-card-base">
                    <div class="id-photo"></div>
                    <div class="id-text-lines">
                        <div class="line w-80"></div>
                        <div class="line w-60"></div>
                        <div class="line w-90"></div>
                    </div>
                    <div class="heatmap-overlay"></div>
                </div>
            `;
            
            ocrTable.innerHTML = `
                <tr><td>MRZ_CHECKSUM</td><td>PASS</td><td class="status-ok">VERIFIED</td></tr>
                <tr><td>EXPIRATION_GATE</td><td>FAIL</td><td class="alert-text">EXPIRED</td></tr>
                <tr><td colspan="3" style="color:#64748B;">[SIMULATED API_GATEWAY DATA]</td></tr>
            `;
            
            extractedFaceBox.innerHTML = `EXTRACTED<br>FACE`;
            extractedFaceBox.style.padding = '';
            extractedFaceBox.style.color = '';
        }
        
        mainSplitPane.classList.add('hidden');
        detailedAnalysis.classList.remove('hidden');
    }
});
