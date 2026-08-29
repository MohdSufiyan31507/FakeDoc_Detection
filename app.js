document.addEventListener('DOMContentLoaded', () => {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const tbody = document.querySelector('.data-table tbody');

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
                // Mock a response based on a random number generator
                const isFlagged = Math.random() > 0.5;
                const mockId = 'DOC-' + Math.floor(Math.random() * 10000);
                const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
                const confScore = (Math.random() * 100).toFixed(1) + '%';
                
                const status = isFlagged ? 'MANUAL_REVIEW' : 'CLEARED';
                
                // Construct the new row
                const tr = document.createElement('tr');
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
                
                // Prepend to the table
                tbody.prepend(tr);

                // Reset Upload Zone
                uploadZone.innerHTML = `
                    <p>SELECT OR DROP TARGET FILE</p>
                    <span class="upload-subtext">SUPPORTED: JPG, PNG, PDF | MAX 10MB</span>
                    <span style="display:block; margin-top:16px; font-weight:bold; color:#2ECC71;">[ PREVIOUS INGESTION COMPLETE ]</span>
                `;
                
                // Reset file input
                fileInput.value = '';

            }, 2000); // 2 second delay to simulate AI processing
        }
    });
});
