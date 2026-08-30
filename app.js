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
    
    // Risk Meter Elements
    const riskScoreBar = document.getElementById('risk-score-bar');
    const riskScoreValue = document.getElementById('risk-score-value');
    const riskScoreDesc = document.getElementById('risk-score-description');

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

            // 1.5 RISK METER
            let rawScore = parseFloat(data.risk_score || "0");
            let pct = (rawScore * 100).toFixed(0);
            
            riskScoreValue.textContent = `${pct}% Risk`;
            riskScoreBar.style.width = `${pct}%`;
            
            if (rawScore < 0.25) {
                riskScoreBar.style.background = "#10B981"; // Emerald Green
                riskScoreValue.style.color = "#10B981";
                riskScoreDesc.innerHTML = "<strong>Low Risk (0 - 24%):</strong> The document appears authentic. No significant digital tampering, invalid formatting, or screen recaptures were detected.";
            } else if (rawScore <= 0.65) {
                riskScoreBar.style.background = "#F59E0B"; // Amber Yellow
                riskScoreValue.style.color = "#F59E0B";
                riskScoreDesc.innerHTML = "<strong>Medium Risk (25% - 65%):</strong> Anomalies detected. The document might have slight physical damage, heavy compression, or formatting discrepancies. Manual review is recommended.";
            } else {
                riskScoreBar.style.background = "#EF4444"; // Red
                riskScoreValue.style.color = "#EF4444";
                riskScoreDesc.innerHTML = "<strong>High Risk (66% - 100%):</strong> Critical fraud signals detected. The document failed major structural checks (e.g., Checksum Math failed), contains photoshopped pixels, or is a photo of a digital screen.";
            }

            // 1.75 DYNAMIC ANOMALY REPORT
            const anomalyContainer = document.getElementById('anomaly-report-container');
            if (anomalyContainer) {
                let anomalies = [];
                
                // Document Format / Math Flags
                if (data.metadata_checks?.doc_validation === 'FAIL') {
                    anomalies.push(`<strong>Format/Math Failure:</strong> ${data.metadata_checks?.doc_details}`);
                }
                // Screen Recapture Flags
                if (data.metadata_checks?.moire?.includes('SCREEN_RECAPTURE')) {
                    anomalies.push(`<strong>Screen Recapture:</strong> The image is a photo taken of a digital monitor or smartphone screen.`);
                }
                // Software / Photoshop Flags
                if (data.metadata_checks?.exif?.includes('SOFTWARE_SIG_DETECTED')) {
                    anomalies.push(`<strong>Metadata Tampering:</strong> Evidence of Photoshop or digital editing software was found inside the file data.`);
                }

                if (anomalies.length > 0) {
                    anomalyContainer.style.display = 'block';
                    anomalyContainer.style.background = rawScore > 0.65 ? '#FEF2F2' : '#FEF3C7';
                    let titleColor = rawScore > 0.65 ? '#991B1B' : '#92400E';
                    let liColor = rawScore > 0.65 ? '#7F1D1D' : '#78350F';
                    
                    anomalyContainer.innerHTML = `
                        <strong style="font-size: 0.875rem; color: ${titleColor};">⚠️ Specific Anomalies Detected by AI:</strong>
                        <ul style="margin: 8px 0 0 20px; font-size: 0.875rem; color: ${liColor}; padding: 0; line-height: 1.6;">
                            ${anomalies.map(a => `<li style="margin-bottom:4px;">${a}</li>`).join('')}
                        </ul>
                    `;
                } else {
                    anomalyContainer.style.display = 'block';
                    anomalyContainer.style.background = '#F0FDF4';
                    anomalyContainer.innerHTML = `<strong style="font-size: 0.875rem; color: #166534;">✅ No structural or digital anomalies detected.</strong>`;
                }
            }

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

    // --- MANUAL OVERRIDE LOGIC ---
    const btnManualApprove = document.getElementById('btn-manual-approve');
    const btnManualReject = document.getElementById('btn-manual-reject');

    async function handleOverride(decision) {
        const docId = reportIdSpan.textContent;
        if (!docId || docId === "--") return;

        try {
            const res = await fetch('http://localhost:8000/api/override', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({doc_id: docId, decision: decision})
            });
            const result = await res.json();
            
            if (result.status === 'success') {
                // Update local memory
                if (analysisStore[docId]) {
                    analysisStore[docId].decision = decision;
                }
                // Refresh UI
                openDetailedAnalysis(docId, true);
                await refreshData();
                alert(`Success: Document manually overridden to ${decision}`);
            } else {
                alert("Override failed: " + result.message);
            }
        } catch (e) {
            console.error("Override error:", e);
            alert("Connection error. Ensure the backend is running.");
        }
    }

    if (btnManualApprove) btnManualApprove.addEventListener('click', () => handleOverride('APPROVED'));
    if (btnManualReject) btnManualReject.addEventListener('click', () => handleOverride('REJECTED'));
});
