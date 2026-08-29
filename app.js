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

    // A store for real analysis results so we can display them when clicked
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

    // --- REAL BACKEND UPLOAD LOGIC ---
    uploadZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            
            // UI Feedback for ingestion
            uploadZone.innerHTML = `
                <p>UPLOADING TO BACKEND</p>
                <span class="upload-subtext">${file.name.toUpperCase()}</span>
                <span style="display:block; margin-top:16px; font-weight:bold; color:#0284C7;">[ AI PROCESSING ]</span>
            `;

            // Prepare form data
            const formData = new FormData();
            formData.append('file', file);

            try {
                // SEND TO REAL PYTHON BACKEND
                const response = await fetch('http://localhost:8000/api/analyze', {
                    method: 'POST',
                    body: formData
                });
                
                const data = await response.json();

                if (data.status === 'success') {
                    // Store the real data
                    analysisStore[data.doc_id] = data;
                    
                    // Inject into table
                    injectRealDocument(data);

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

    // --- LIVE TELEMETRY SIMULATION (Keep this running so it looks alive) ---
    setInterval(() => {
        const baseLoad = 40;
        const variance = (Math.random() * 15) - 5; 
        sysLoadSpan.textContent = (baseLoad + variance).toFixed(1) + '%';
        tickCount++;
        tickCounterSpan.textContent = tickCount;
    }, 1000);

    // Keep injecting fake stream data to look busy, but mark them as API_GATEWAY
    setInterval(() => {
        if (!document.getElementById('dashboard-view').classList.contains('hidden') && 
            detailedAnalysis.classList.contains('hidden')) {
            injectFakeStreamDocument();
        }
    }, Math.floor(Math.random() * 5000) + 8000); 

    // --- INJECTION HELPERS ---
    
    function injectRealDocument(data) {
        const now = new Date();
        const timeString = now.toTimeString().split(' ')[0];
        const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
        
        const tr = document.createElement('tr');
        tr.classList.add('interactive-row');
        tr.dataset.id = data.doc_id;
        if (data.is_flagged) tr.classList.add('flagged');
        
        tr.innerHTML = `
            <td>${data.doc_id}</td>
            <td>${timestamp}</td>
            <td style="color:#3B82F6; font-weight:bold;">REAL_UPLOAD</td>
            <td>${data.confidence_score}</td>
            <td>${data.decision}</td>
        `;
        
        tr.addEventListener('click', () => openDetailedAnalysis(data.doc_id, true));
        
        if (tbody.children.length >= 10) tbody.removeChild(tbody.lastChild);
        tbody.prepend(tr);

        // Update Audit Log
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<span class="log-time">[${timeString}]</span> <span class="log-sys">PYTHON_BACKEND</span>: Analyzed ${data.filename} -> ${data.doc_id}. ELA_CONF: ${data.confidence_score}. ROUTE: ${data.decision}`;
        logTerminal.prepend(logEntry);
    }

    function injectFakeStreamDocument() {
        const isFlagged = Math.random() > 0.8; 
        const mockId = 'DOC-' + Math.floor(Math.random() * 100000);
        
        const now = new Date();
        const timeString = now.toTimeString().split(' ')[0];
        const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
        const confScore = (Math.random() * 100).toFixed(1) + '%';
        
        const status = isFlagged ? 'QUARANTINE_L1' : 'SYS_CLEARED';
        
        const tr = document.createElement('tr');
        tr.classList.add('interactive-row');
        tr.dataset.id = mockId;
        if (isFlagged) tr.classList.add('flagged');
        
        tr.innerHTML = `
            <td>${mockId}</td>
            <td>${timestamp}</td>
            <td>API_GATEWAY</td>
            <td>${confScore}</td>
            <td>${status}</td>
        `;
        
        tr.addEventListener('click', () => openDetailedAnalysis(mockId, false));
        
        if (tbody.children.length >= 10) tbody.removeChild(tbody.lastChild);
        tbody.prepend(tr);

        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<span class="log-time">[${timeString}]</span> <span class="log-sys">SYS_GATE</span>: Event ${mockId}. CONF: ${confScore}. ROUTE: ${status}`;
        logTerminal.prepend(logEntry);
    }

    // --- DETAILED ANALYSIS LOGIC ---
    closeAnalysisBtn.addEventListener('click', () => {
        detailedAnalysis.classList.add('hidden');
        mainSplitPane.classList.remove('hidden');
    });

    function openDetailedAnalysis(docId, isReal = false) {
        reportIdSpan.textContent = docId;
        
        if (isReal && analysisStore[docId]) {
            // Render the REAL ELA heatmap from the Python backend!
            const data = analysisStore[docId];
            forensicImageContainer.innerHTML = `
                <img src="${data.ela_heatmap}" style="max-width:100%; max-height:100%; object-fit:contain; border: 1px solid #94A3B8;">
            `;
            
            // Render the REAL OCR data and MRZ Status
            let tableHTML = '';
            
            // Add MRZ Verification Row
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

            // Render REAL Extracted Face
            if (data.extracted_face) {
                extractedFaceBox.innerHTML = `<img src="${data.extracted_face}" style="max-width:100%; max-height:100%; object-fit:cover;">`;
                extractedFaceBox.style.padding = '0'; // remove padding so image fills box
            } else {
                extractedFaceBox.innerHTML = `NO FACE<br>DETECTED`;
                extractedFaceBox.style.padding = ''; 
                extractedFaceBox.style.color = '#EF4444'; // Red alert text
            }

        } else {
            // Render the fake placeholder
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

    // Populate initial rows
    for(let i=0; i<3; i++) {
        injectFakeStreamDocument();
    }
});
