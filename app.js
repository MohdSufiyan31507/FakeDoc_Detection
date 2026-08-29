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
    
    // View Elements
    const dashboardView = document.getElementById('dashboard-view');
    const detailedAnalysis = document.getElementById('detailed-analysis');
    const closeAnalysisBtn = document.getElementById('close-analysis');
    
    // Report Elements
    const reportIdSpan = document.getElementById('report-id');
    const finalDecisionBadge = document.getElementById('final-decision-badge');
    const forensicImageContainer = document.getElementById('forensic-image-container');
    const extractedFaceBox = document.getElementById('extracted-face-box');
    const securityChecklistTable = document.getElementById('security-checklist-table');
    const extractedTextTable = document.getElementById('extracted-text-table');

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
            topBarTitle.textContent = link.textContent.trim();
        });
    });

    // --- HELPER: Translate Tech Jargon to Plain English ---
    function formatDecision(decisionStr) {
        if (decisionStr === 'REJECTED' || decisionStr === 'QUARANTINE_L1') {
            return { text: "FAKE / REJECTED", color: "#DC2626", bg: "#FEE2E2" };
        } else if (decisionStr === 'APPROVED' || decisionStr === 'SYS_CLEARED') {
            return { text: "REAL / APPROVED", color: "#059669", bg: "#D1FAE5" };
        } else {
            return { text: "REVIEW NEEDED", color: "#D97706", bg: "#FEF3C7" };
        }
    }

    // --- REAL DATABASE FETCHING ---
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
                    
                    const decision = formatDecision(doc.decision);
                    if (doc.is_flagged) tr.classList.add('flagged');
                    
                    let srcName = doc.source_type === 'REAL_UPLOAD' ? 'Manual Upload' : 'Background Scan';
                    let srcColor = doc.source_type === 'REAL_UPLOAD' ? 'color:#3B82F6; font-weight:bold;' : '';
                    
                    tr.innerHTML = `
                        <td>${doc.doc_id}</td>
                        <td>${doc.timestamp}</td>
                        <td style="${srcColor}">${srcName}</td>
                        <td>${doc.confidence}</td>
                        <td style="color: ${decision.color}; font-weight: bold;">${decision.text}</td>
                    `;
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
                    logEntry.innerHTML = `<span class="log-time">[${log.time_str}]</span> <strong>${log.actor}</strong>: ${log.action}`;
                    logTerminal.appendChild(logEntry);
                });
            }
        } catch (err) {
            console.error("DB Fetch Error (Is backend running?):", err);
        }
    }

    // Load data on startup
    refreshData();


    // --- UPLOAD LOGIC ---
    let expectedType = null;
    const docCards = document.querySelectorAll('.doc-card');
    const uploadView = document.getElementById('upload-view');
    const backToDashFromUpload = document.getElementById('back-to-dash-from-upload');
    const uploadTitle = document.getElementById('upload-title');

    docCards.forEach(card => {
        card.addEventListener('click', () => {
            expectedType = card.getAttribute('data-type');
            
            dashboardView.classList.add('hidden');
            detailedAnalysis.classList.add('hidden');
            uploadView.classList.remove('hidden');
            
            uploadTitle.textContent = "Upload " + expectedType;
            uploadZone.innerHTML = `
                <p style="font-size: 1.25rem;">Click here to select your image</p>
                <span class="upload-subtext">Supports JPG, PNG (High Resolution Recommended)</span>
            `;
        });
    });

    backToDashFromUpload.addEventListener('click', () => {
        uploadView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        expectedType = null;
    });

    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        if (e.target.files.length > 0) {
            const file = e.target.files[0];
            
            uploadZone.innerHTML = `
                <p style="font-size: 1.25rem;">Analyzing Document...</p>
                <span class="upload-subtext" style="color: #3B82F6;">Running AI Forensics. Do not close the page.</span>
            `;

            const formData = new FormData();
            formData.append('file', file);
            if (expectedType) {
                formData.append('expected_type', expectedType);
            }

            try {
                const response = await fetch('http://localhost:8000/api/analyze', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                if (data.status === 'success') {
                    analysisStore[data.doc_id] = data;
                    await refreshData();

                    // Go back to dashboard and open the analysis automatically
                    uploadView.classList.add('hidden');
                    openDetailedAnalysis(data.doc_id, true);
                    expectedType = null;
                } else {
                    uploadZone.innerHTML = `
                        <p style="color:#DC2626; font-size: 1.25rem;">Analysis Failed</p>
                        <span class="upload-subtext">${data.message || 'Check Server'}</span>
                    `;
                }
            } catch (err) {
                console.error(err);
                uploadZone.innerHTML = `
                    <p style="color:#DC2626; font-size: 1.25rem;">Connection Error</p>
                    <span class="upload-subtext">Is the Python backend running?</span>
                `;
            }
            fileInput.value = '';
        }
    });

    // --- BACKGROUND SIMULATION REMOVED ---
    // (The system will now only show real, manual uploads) 

    // --- DETAILED ANALYSIS LOGIC ---
    closeAnalysisBtn.addEventListener('click', () => {
        detailedAnalysis.classList.add('hidden');
        dashboardView.classList.remove('hidden');
    });

    function openDetailedAnalysis(docId, isReal = false) {
        reportIdSpan.textContent = docId;
        
        if (isReal && analysisStore[docId]) {
            const data = analysisStore[docId];
            
            // 1. TOP BADGE & TYPE
            const decision = formatDecision(data.decision);
            finalDecisionBadge.innerHTML = `<span style="font-size:14px; color:#64748B; margin-right:12px;">DETECTED: ${data.doc_type || 'UNKNOWN'}</span> 
                                            <span style="background:${decision.bg}; color:${decision.color}; padding:8px 16px; border-radius:6px; border:1px solid ${decision.color};">${decision.text}</span>`;

            // 2. VISUALS
            forensicImageContainer.innerHTML = `<img src="${data.ela_heatmap}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:8px;">`;
            
            if (data.extracted_face) {
                extractedFaceBox.innerHTML = `<img src="${data.extracted_face}" style="max-width:100%; max-height:100%; object-fit:cover; border-radius:8px;">`;
                extractedFaceBox.style.border = "none";
            } else {
                extractedFaceBox.innerHTML = `No Face Found`;
            }

            // 3. SECURITY CHECKLIST (Dynamic Multi-ID)
            const docStatus = data.metadata_checks?.doc_validation || 'NOT_FOUND';
            const docDetails = data.metadata_checks?.doc_details || '';
            let docDisplay = docStatus === 'PASS' ? `<span style="color:#059669;">Passed (${docDetails})</span>` : `<span style="color:#DC2626;">Failed (${docDetails})</span>`;

            const digilockerStatus = data.metadata_checks?.digilocker || 'NOT_FOUND';
            let digiDisplay = digilockerStatus === 'PASS' ? '<span style="color:#059669;">Verified with UIDAI/DigiLocker</span>' : '<span style="color:#DC2626;">UIDAI/DigiLocker Verification Failed</span>';

            const exifDetails = data.metadata_checks?.exif || 'NOT_FOUND';
            let exifDisplay = exifDetails.includes('SOFTWARE_SIG_DETECTED') ? '<span style="color:#DC2626;">Failed (Photoshopped)</span>' : '<span style="color:#059669;">Passed (Original File)</span>';

            const moireDetails = data.metadata_checks?.moire || 'NOT_FOUND';
            let moireDisplay = moireDetails.includes('SCREEN_RECAPTURE') ? '<span style="color:#DC2626;">Failed (Photo of a screen)</span>' : '<span style="color:#059669;">Passed (Natural photo)</span>';

            securityChecklistTable.innerHTML = `
                <tr>
                    <td style="font-weight:600; width:40%;">Document Format Check</td>
                    <td>${docDisplay}</td>
                </tr>
                <tr>
                    <td style="font-weight:600;">DigiLocker API Sync</td>
                    <td>${digiDisplay}</td>
                </tr>
                <tr>
                    <td style="font-weight:600;">Software/Photoshop Check</td>
                    <td>${exifDisplay}</td>
                </tr>
                <tr>
                    <td style="font-weight:600;">Screen Photo Check</td>
                    <td>${moireDisplay}</td>
                </tr>
            `;

            // 4. EXTRACTED TEXT
            if (data.extracted_text && data.extracted_text.length > 0) {
                extractedTextTable.innerHTML = data.extracted_text.map(text => `
                    <tr><td>${text}</td></tr>
                `).join('');
            } else {
                extractedTextTable.innerHTML = `<tr><td style="color:#64748B;">No text could be read from this document.</td></tr>`;
            }

        } else {
            // Placeholder for simulated docs
            finalDecisionBadge.textContent = "SIMULATED DATA";
            finalDecisionBadge.style.backgroundColor = "#F1F5F9";
            finalDecisionBadge.style.color = "#64748B";
            
            forensicImageContainer.innerHTML = `<p style="color:#64748B;">[ Heatmap only available for manual uploads ]</p>`;
            extractedFaceBox.innerHTML = `No Image`;
            
            securityChecklistTable.innerHTML = `<tr><td>Simulated background data cannot be viewed in deep analysis.</td></tr>`;
            extractedTextTable.innerHTML = ``;
        }
        
        dashboardView.classList.add('hidden');
        detailedAnalysis.classList.remove('hidden');
    }
});
