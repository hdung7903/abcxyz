// Popup script
const statusDiv = document.getElementById('status');
const toggleBtn = document.getElementById('toggleBtn');

// Update UI based on current state
function updateUI(enabled) {
  if (enabled) {
    statusDiv.textContent = 'Đang chặn request';
    statusDiv.className = 'status enabled';
    toggleBtn.textContent = 'Tắt chặn';
  } else {
    statusDiv.textContent = 'Không chặn';
    statusDiv.className = 'status disabled';
    toggleBtn.textContent = 'Bật chặn';
  }
}

// Get initial status
chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
  updateUI(response.enabled);
});

// Toggle blocking when button is clicked
toggleBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'toggleBlocking' }, (response) => {
    updateUI(response.enabled);
  });
});
