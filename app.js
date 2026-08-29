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

    // Handle Navigation
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            // Remove active from all
            navLinks.forEach(l => l.classList.remove('active'));
            // Add active to clicked
            link.classList.add('active');
            
            // Hide all views
            views.forEach(view => view.classList.add('hidden'));
            
            // Show target view
            const targetId = link.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');

            // Update Header
            topBarTitle.textContent = link.textContent.replace(/\[.*?\]/, '').trim();

            // Special case: if returning to dashboard, ensure split pane is visible and analysis is hidden
            if (targetId === 'dashboard-view') {
                mainSplitPane.classList.remove('hidden');
                detailedAnalysis.classList.add('hidden');
            }
        });
    });


    // Trigger file selection on click
    uploadZone.addEventListener('click', () => {
        fileInput.click();
    });

    // Handle file selection and mock AI analysis
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            const fileName = e.target.files[0].name;
            
            // UI Feedback for ingestion
            uploadZone.innerHTML = `
                <p>FILE SELECTED</p>
                <span class="upload-subtext">${fileName.toUpperCase()}</span>
                <span style="display:block; margin-top:16px; font-weight:bold; color:#E74C3C;">[ AWAITING INGESTION ]</span>
            `;

            // Simulate AI processing delay
            setTimeout(() => {
                // Mock a response
                const isFlagged = Math.random() > 0.5;
                const mockId = 'DOC-' + Math.floor(Math.random() * 10000);
                
                // Get current time like HH:MM:SS
                const now = new Date();
                const timeString = now.toTimeString().split(' ')[0];
                const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
                const confScore = (Math.random() * 100).toFixed(1) + '%';
                
                const status = isFlagged ? 'MANUAL_REVIEW' : 'CLEARED';
                
                // Construct the new row
                const tr = document.createElement('tr');
                tr.classList.add('interactive-row');
                tr.dataset.id = mockId;
                
                if (isFlagged) {
                    tr.classList.add('flagged');
                }
                
                tr.innerHTML = `
                    <td>${mockId}</td>
                    <td>${timestamp}</td>
                    <td>UNKNOWN_FORMAT</td>
                    <td>${confScore}</td>
                    <td>${status}</td>
                `;
                
                // Add click listener to the new row
                tr.addEventListener('click', () => openDetailedAnalysis(mockId));

                // Prepend to the table
                tbody.prepend(tr);

                // Add to Audit Log
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.innerHTML = `<span class="log-time">[${timeString}]</span> <span class="log-sys">SYS</span>: Ingested ${mockId} (${fileName}). AI_Score: ${confScore}. Route: ${status}`;
                logTerminal.prepend(logEntry);

                // Reset Upload Zone
                uploadZone.innerHTML = `
                    <p>SELECT OR DROP TARGET FILE</p>
                    <span class="upload-subtext">SUPPORTED: JPG, PNG, PDF | MAX 10MB</span>
                    <span style="display:block; margin-top:16px; font-weight:bold; color:#2ECC71;">[ PREVIOUS INGESTION COMPLETE ]</span>
                `;
                
                fileInput.value = '';

            }, 2000);
        }
    });

    // Attach click listeners to existing dashboard rows
    const existingRows = document.querySelectorAll('#dashboard-view .interactive-row');
    existingRows.forEach(row => {
        row.addEventListener('click', () => {
            openDetailedAnalysis(row.dataset.id);
        });
    });

    // Handle closing the analysis view
    closeAnalysisBtn.addEventListener('click', () => {
        detailedAnalysis.classList.add('hidden');
        mainSplitPane.classList.remove('hidden');
    });

    function openDetailedAnalysis(docId) {
        reportIdSpan.textContent = docId;
        mainSplitPane.classList.add('hidden');
        detailedAnalysis.classList.remove('hidden');
    }
});
