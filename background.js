// Background service worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('Coursera Request Blocker đã được cài đặt');
  
  // Set default state to enabled
  chrome.storage.local.set({ enabled: true });
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggleBlocking') {
    chrome.storage.local.get(['enabled'], (result) => {
      const newState = !result.enabled;
      chrome.storage.local.set({ enabled: newState });
      
      // Update declarative net request rules
      if (newState) {
        chrome.declarativeNetRequest.updateEnabledRulesets({
          enableRulesetIds: ['ruleset_1']
        });
      } else {
        chrome.declarativeNetRequest.updateEnabledRulesets({
          disableRulesetIds: ['ruleset_1']
        });
      }
      
      sendResponse({ enabled: newState });
    });
    return true; // Will respond asynchronously
  }
  
  if (request.action === 'getStatus') {
    chrome.storage.local.get(['enabled'], (result) => {
      sendResponse({ enabled: result.enabled !== false });
    });
    return true;
  }
});
