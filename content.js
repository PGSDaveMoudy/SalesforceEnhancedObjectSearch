/**
* @File Name : content.js
* @Description : Handles UI modifications, Quick Find customization, auto-scroll, picklist processing, and XLSX export functionality.
*               On the home page, a modal allows selection of objects to export.
*               On the detail (fields and relationships) page, an export button is added inline (to the right of the Quick Find box)
*               along with the New, Deleted Fields, Field Dependencies, and Set History Tracking buttons.
* @Author : Dave Moudy
* @Last Modified By :
* @Last Modified On :
* @Modification Log :
*==============================================================================
* Ver | Date         | Author      | Modification
*==============================================================================
* 1.0 | February 16,2025 |            | Initial Version
* 1.1 | February 20,2025 | Dave Moudy | Placed export button next to Quick Find, used closest scrollable parent for autoscroll
* 1.2 | February 20,2025 | Dave Moudy | Implemented fetching of custom object API name using Tooling API
* 1.3 | February 17,2025 | Dave Moudy | Added mapping for field types to Salesforce-style terms and updated export functions
* 1.4 | February 17,2025 | Dave Moudy | Adjusted inline export XLSX button position and added spinner for opening the export modal
**/

// ---------------------
// Utility Functions
// ---------------------

// Wait for an element to appear in the DOM, up to a specified timeout.
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver((mutations, obs) => {
      const el = document.querySelector(selector);
      if (el) {
        obs.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for element: ${selector}`));
    }, timeout);
  });
}

// Find the closest scrollable parent of an element (used for autoscroll).
function findScrollableParent(el) {
  let parent = el.parentElement;
  while (parent && parent !== document.documentElement) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

// Scroll a container until its content no longer grows in height.
function autoScrollAndWait(container) {
  return new Promise(resolve => {
    let lastHeight = container.scrollHeight;
    function scrollStep() {
      container.scrollTop = container.scrollHeight;
      setTimeout(() => {
        const newHeight = container.scrollHeight;
        if (newHeight > lastHeight) {
          lastHeight = newHeight;
          scrollStep();
        } else {
          resolve();
        }
      }, 500);
    }
    scrollStep();
  });
}

// Extract the object API name from the URL for detail pages.
// If the extracted identifier is a Salesforce ID, fetch the API name via the Tooling API.
async function getObjectApiNameFromURL() {
  const match = window.location.pathname.match(/(?:ObjectManager\/|\/sObject\/)([^\/]+)/);
  let identifier = match && match[1] ? decodeURIComponent(match[1]) : null;
  if (!identifier) return null;
  // If identifier is a Salesforce ID (15 or 18 alphanumeric characters)
  if (/^[a-zA-Z0-9]{15,18}$/.test(identifier)) {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "fetchCustomObjectApiName", objectId: identifier, origin: window.location.origin }, resolve);
    });
    if (response && response.success) {
      return response.apiName;
    } else {
      console.error("Failed to fetch custom object API name:", response.error);
      return null;
    }
  }
  // Otherwise, assume it’s already the API name.
  return identifier;
}

// Remove extraneous modules from Setup Home
function removeSetupHomeModules() {
  document.querySelectorAll("section.onesetupModule").forEach(module => module.remove());
}

// Check if we are on Object Manager home
function isObjectManagerHomePage() {
  return window.location.pathname.includes("/ObjectManager/home");
}

// ---------------------
// Quick Find Handling
// ---------------------

async function getOriginalQuickFind() {
  let container = document.querySelector(".objectManagerGlobalSearchBox");
  if (!container) {
    container = document.querySelector("div[role='search']");
  }
  if (!container) throw new Error("Quick Find container not found.");
  
  const input = container.querySelector("input[type='search']");
  if (!input) throw new Error("Quick Find input not found.");
  return input;
}

function setupCustomQuickFind(originalInput) {
  if (!originalInput) {
    console.error("Original Quick Find input not found.");
    return;
  }
  if (!originalInput.parentNode) {
    console.error("Original Quick Find input has no parent node.");
    return;
  }
  if (originalInput.dataset.customized === "true") {
    console.log("Custom Quick Find already set up.");
    return;
  }
  
  const newInput = originalInput.cloneNode(true);
  newInput.id = "customQuickFind";
  newInput.dataset.customized = "true";
  originalInput.parentNode.replaceChild(newInput, originalInput);

  // Ensure the container displays its children inline.
  const parent = newInput.parentNode;
  parent.style.display = "flex";
  parent.style.justifyContent = "flex-end";
  parent.style.alignItems = "center";
  
  newInput.addEventListener("input", onQuickFindInput);
  console.log("Custom Quick Find attached.");

  // For detail pages, append the inline Export XLSX button to the same container.
  if (!isObjectManagerHomePage()) {
    addInlineExportButton(parent);
  }
}

function onQuickFindInput(e) {
  const query = e.target.value.trim().toLowerCase();
  const tableBody = document.querySelector("table tbody");
  if (!tableBody) return;
  const rows = tableBody.querySelectorAll("tr");
  
  rows.forEach(row => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 3) return;
    const fieldLabel = cells[0].innerText.toLowerCase();
    const apiName = cells[1].innerText.toLowerCase();
    const fieldType = cells[2].innerText.toLowerCase();
    const picklistText = row.dataset.picklistText ? row.dataset.picklistText.toLowerCase() : "";
    const combined = fieldLabel + " " + picklistText;
    
    row.style.display = (query === "" || 
                         combined.includes(query) || 
                         apiName.includes(query) || 
                         fieldType.includes(query))
      ? ""
      : "none";
  });
}

// ---------------------
// Picklist & Export
// ---------------------

function fetchPicklistValuesViaBackground(row, objectName, fieldApiName, isStandard) {
  const origin = window.location.origin;
  chrome.runtime.sendMessage(
    {
      type: "fetchPicklistValues",
      objectName,
      fieldApiName,
      origin,
      isStandard
    },
    response => {
      if (response && response.success) {
        const picklistText = response.data.picklistText || "";
        row.dataset.picklistText = picklistText;
        const labelCell = row.querySelector("td");
        if (labelCell) labelCell.setAttribute("title", picklistText);
        console.log(`Fetched picklist for ${fieldApiName}: ${picklistText}`);
        const customQF = document.getElementById("customQuickFind");
        if (customQF) {
          onQuickFindInput({ target: { value: customQF.value } });
        }
      } else {
        console.error("Error fetching picklist values:", response && response.error);
      }
    }
  );
}

async function processPicklistRows() {
  const tableBody = document.querySelector("table tbody");
  if (!tableBody) return;
  
  const objectName = await getObjectApiNameFromURL();
  if (!objectName) {
    console.error("Could not determine object name.");
    return;
  }
  
  const rows = tableBody.querySelectorAll("tr");
  rows.forEach(row => {
    if (row.dataset.picklistFetched === "true") return;
    
    const cells = row.querySelectorAll("td");
    if (cells.length < 3) return;
    
    const fieldType = cells[2].innerText.toLowerCase();
    const fieldApiName = cells[1].innerText.trim();
    const isStandard = !fieldApiName.endsWith("__c");
    
    if (fieldType.includes("picklist")) {
      fetchPicklistValuesViaBackground(row, objectName, fieldApiName, isStandard);
    } else {
      row.dataset.picklistText = "";
      const labelCell = row.querySelector("td");
      if (labelCell) labelCell.removeAttribute("title");
    }
    row.dataset.picklistFetched = "true";
  });
}

// Helper to ensure unique sheet names in XLSX
function getUniqueSheetName(sheetName, existingNames) {
  let uniqueName = sheetName;
  let suffix = 1;
  while (existingNames.includes(uniqueName)) {
    const base = sheetName.substring(0, 31 - suffix.toString().length);
    uniqueName = base + suffix;
    suffix++;
  }
  return uniqueName;
}

// Spinner
function showSpinner() {
  if (document.getElementById("exportSpinner")) return;
  const spinner = document.createElement("div");
  spinner.id = "exportSpinner";
  spinner.style.cssText = "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 9999;";
  spinner.innerHTML = '<div class="spinner"></div>';
  document.body.appendChild(spinner);
  if (!document.getElementById("spinnerStyles")) {
    const style = document.createElement("style");
    style.id = "spinnerStyles";
    style.textContent = `
      .spinner {
        border: 12px solid #f3f3f3;
        border-top: 12px solid #0070d2;
        border-radius: 50%;
        width: 60px;
        height: 60px;
        animation: spin 1s linear infinite;
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }
}

function hideSpinner() {
  const spinner = document.getElementById("exportSpinner");
  if (spinner) spinner.remove();
}

// ---------------------
// Helper: Map Field Types for Export
// ---------------------
/**
* @File Name : content.js
* @Description : Helper to map field types to Salesforce-specific terms for export.
* @Author : Dave Moudy
* @Last Modified By :
* @Last Modified On :
* @Modification Log :
*==============================================================================
* Ver | Date         | Author    | Modification
*==============================================================================  
* 1.3 | February 17,2025 | Dave Moudy | Added mapping for field types (e.g., Reference → Lookup(User), Double → Number(4,0), String → Text(500))
**/
function mapFieldTypeForExport(fieldType, fieldLength) {
  switch (fieldType.toLowerCase()) {
    case 'reference':
      return 'Lookup(User)';
    case 'double':
      return 'Number(4,0)';
    case 'string':
      return `Text(${fieldLength || 500})`;
    default:
      return fieldType.charAt(0).toUpperCase() + fieldType.slice(1);
  }
}

// ---------------------
// Export Routines
// ---------------------

// 1) Export fields of current object
async function exportCurrentObjectFieldsToXLSX() {
  showSpinner();
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = tableBody.querySelectorAll("tr");
    let data = [];
    data.push(["Field Label", "API Name", "Field Type", "Picklist Values"]);
    rows.forEach(row => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 3) return;
      const fieldLabel = cells[0].innerText.trim();
      const apiName = cells[1].innerText.trim();
      const originalFieldType = cells[2].innerText.trim();
      // Map field type using our helper; using a default length of 500 for current object fields
      const mappedFieldType = mapFieldTypeForExport(originalFieldType, 500);
      const picklistText = row.dataset.picklistText ? row.dataset.picklistText.trim() : "";
      data.push([fieldLabel, apiName, mappedFieldType, picklistText]);
    });
    let wb = XLSX.utils.book_new();
    const objectName = (await getObjectApiNameFromURL()) || "Object";
    let sheetName = objectName.length > 31 ? objectName.substring(0, 31) : objectName;
    let ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${objectName}_fields_export.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting current object fields to XLSX:", error);
  } finally {
    hideSpinner();
  }
}

// 2) Export all objects from the home page
async function exportFullDatabaseToXLSX() {
  showSpinner();
  try {
    const tableBody = await waitForElement("table tbody");
    const rows = Array.from(tableBody.querySelectorAll("tr"));
    if (rows.length === 0) {
      console.error("No objects found on the home page.");
      return;
    }
    const objects = [];
    for (const row of rows) {
      const link = row.querySelector("a");
      if (link && link.href) {
        const match = link.href.match(/(?:ObjectManager\/|\/sObject\/)([^\/]+)/);
        if (match && match[1]) {
          let identifier = decodeURIComponent(match[1]);
          let objectApiName = identifier;
          if (/^[a-zA-Z0-9]{15,18}$/.test(identifier)) {
            const response = await new Promise(resolve => {
              chrome.runtime.sendMessage({ type: "fetchCustomObjectApiName", objectId: identifier, origin: window.location.origin }, resolve);
            });
            if (response && response.success) {
              objectApiName = response.apiName;
            } else {
              console.error("Failed to fetch custom object API name for home page row:", response.error);
            }
          }
          const objectLabel = row.querySelector("td")
            ? row.querySelector("td").innerText.trim()
            : objectApiName;
          objects.push({ objectLabel, objectApiName });
        }
      }
    }
    
    let wb = XLSX.utils.book_new();
    const usedSheetNames = [];
    
    for (const obj of objects) {
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          {
            type: "fetchObjectDescribe",
            objectApiName: obj.objectApiName,
            origin: window.location.origin
          },
          resolve
        );
      });
      let data = [];
      data.push(["Field Label", "API Name", "Field Type", "Field Length", "Picklist Values"]);
      if (response && response.success && response.fields) {
        response.fields.forEach(field => {
          const mappedFieldType = mapFieldTypeForExport(field.fieldType, field.fieldLength);
          data.push([
            field.fieldLabel,
            field.fieldApiName,
            mappedFieldType,
            field.fieldLength ? field.fieldLength : "",
            field.picklistValues
          ]);
        });
      } else {
        data.push([obj.objectLabel, obj.objectApiName, "Error fetching fields", "", ""]);
      }
      
      let sheetName = obj.objectLabel;
      sheetName = sheetName.length > 31 ? sheetName.substring(0, 31) : sheetName;
      sheetName = getUniqueSheetName(sheetName, usedSheetNames);
      usedSheetNames.push(sheetName);
      
      let ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "salesforce_objects_fields_export.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting full database to XLSX:", error);
  } finally {
    hideSpinner();
  }
}

// 3) Export only selected objects (used by the modal)
async function exportSelectedObjectsToXLSX(selectedObjects) {
  showSpinner();
  try {
    let wb = XLSX.utils.book_new();
    const usedSheetNames = [];
    for (const obj of selectedObjects) {
      const response = await new Promise(resolve => {
        chrome.runtime.sendMessage(
          {
            type: "fetchObjectDescribe",
            objectApiName: obj.objectApiName,
            origin: window.location.origin
          },
          resolve
        );
      });
      let data = [];
      data.push(["Field Label", "API Name", "Field Type", "Field Length", "Picklist Values"]);
      if (response && response.success && response.fields) {
        response.fields.forEach(field => {
          const mappedFieldType = mapFieldTypeForExport(field.fieldType, field.fieldLength);
          data.push([
            field.fieldLabel,
            field.fieldApiName,
            mappedFieldType,
            field.fieldLength ? field.fieldLength : "",
            field.picklistValues
          ]);
        });
      } else {
        data.push([obj.objectLabel, obj.objectApiName, "Error fetching fields", "", ""]);
      }
      let sheetName = obj.objectLabel;
      sheetName = sheetName.length > 31 ? sheetName.substring(0, 31) : sheetName;
      sheetName = getUniqueSheetName(sheetName, usedSheetNames);
      usedSheetNames.push(sheetName);
      let ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "selected_salesforce_objects_fields_export.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (error) {
    console.error("Error exporting selected objects to XLSX:", error);
  } finally {
    hideSpinner();
  }
}

// ---------------------
// Inline Export Button (Detail Page)
// ---------------------
function addInlineExportButton(parentContainer) {
  if (document.getElementById("exportDetailXLSXButton")) return;
  
  const exportButton = document.createElement("button");
  exportButton.id = "exportDetailXLSXButton";
  exportButton.textContent = "Export XLSX";
  exportButton.style.cssText =
    "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
  exportButton.addEventListener("click", exportCurrentObjectFieldsToXLSX);
  parentContainer.appendChild(exportButton);
}

// ---------------------
// Modal for selecting objects to export
// ---------------------
async function showExportSelectionModal() {
  try {
    showSpinner(); // Show spinner while building the modal
    const tableBody = await waitForElement("table tbody");
    const rows = Array.from(tableBody.querySelectorAll("tr"));
    const objects = [];
    for (const row of rows) {
      const link = row.querySelector("a");
      if (link && link.href) {
        const match = link.href.match(/(?:ObjectManager\/|\/sObject\/)([^\/]+)/);
        if (match && match[1]) {
          let identifier = decodeURIComponent(match[1]);
          let objectApiName = identifier;
          if (/^[a-zA-Z0-9]{15,18}$/.test(identifier)) {
            const response = await new Promise(resolve => {
              chrome.runtime.sendMessage({ type: "fetchCustomObjectApiName", objectId: identifier, origin: window.location.origin }, resolve);
            });
            if (response && response.success) {
              objectApiName = response.apiName;
            } else {
              console.error("Failed to fetch custom object API name for modal:", response.error);
            }
          }
          const objectLabel = row.querySelector("td")
            ? row.querySelector("td").innerText.trim()
            : objectApiName;
          objects.push({ objectLabel, objectApiName });
        }
      }
    }
    // Create modal overlay
    const modal = document.createElement("div");
    modal.id = "exportSelectionModal";
    modal.style.cssText =
      "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;";
    
    const container = document.createElement("div");
    container.style.cssText =
      "background: white; padding: 20px; border-radius: 5px; max-height: 80%; overflow-y: auto; width: 300px;";
    
    const title = document.createElement("h2");
    title.innerText = "Select Objects to Export";
    container.appendChild(title);
    
    // Header with toggle, Export Selected, and Cancel
    const headerContainer = document.createElement("div");
    headerContainer.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 10px;";
    
    const toggleBtn = document.createElement("button");
    toggleBtn.innerText = "Select All";
    toggleBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    // Updated toggle button event listener to only target visible (filtered) checkboxes:
    toggleBtn.addEventListener("click", () => {
      const checkboxes = Array.from(container.querySelectorAll("label > input[type='checkbox']"))
        .filter(cb => window.getComputedStyle(cb.parentElement).display !== "none");
      const allChecked = checkboxes.every(cb => cb.checked);
      checkboxes.forEach(cb => { cb.checked = !allChecked; });
      toggleBtn.innerText = allChecked ? "Select All" : "Deselect All";
    });
    
    const headerExportBtn = document.createElement("button");
    headerExportBtn.innerText = "Export Selected";
    headerExportBtn.style.cssText = "padding: 5px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer;";
    headerExportBtn.addEventListener("click", async () => {
      const selectedCheckboxes = container.querySelectorAll("label > input[type='checkbox']:checked");
      const selectedObjects = [];
      selectedCheckboxes.forEach(cb => {
        const apiName = cb.value;
        const correspondingObj = objects.find(o => o.objectApiName === apiName);
        if (correspondingObj) {
          selectedObjects.push(correspondingObj);
        }
      });
      document.body.removeChild(modal);
      await exportSelectedObjectsToXLSX(selectedObjects);
    });
    
    const headerCancelBtn = document.createElement("button");
    headerCancelBtn.innerText = "Cancel";
    headerCancelBtn.style.cssText = "padding: 5px; background: #aaa; color: white; border: none; border-radius: 4px; cursor: pointer;";
    headerCancelBtn.addEventListener("click", () => {
      document.body.removeChild(modal);
    });
    
    headerContainer.appendChild(toggleBtn);
    headerContainer.appendChild(headerExportBtn);
    headerContainer.appendChild(headerCancelBtn);
    container.appendChild(headerContainer);
    
    // Search filter
    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search objects...";
    searchInput.style.cssText =
      "width: 100%; padding: 5px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px;";
    searchInput.addEventListener("input", () => {
      const filter = searchInput.value.trim().toLowerCase();
      const labels = container.querySelectorAll("label");
      labels.forEach(label => {
        const text = label.textContent.toLowerCase();
        label.style.display = text.includes(filter) ? "block" : "none";
      });
    });
    container.appendChild(searchInput);
    
    // List objects with checkboxes
    objects.forEach(obj => {
      const label = document.createElement("label");
      label.style.display = "block";
      label.style.marginBottom = "5px";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = obj.objectApiName;
      checkbox.checked = false;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(" " + obj.objectLabel));
      container.appendChild(label);
    });
    
    // Bottom Export Selected
    const bottomExportBtn = document.createElement("button");
    bottomExportBtn.innerText = "Export Selected";
    bottomExportBtn.style.cssText =
      "margin-top: 10px; padding: 5px 10px; background: #0070d2; color: white; border: none; border-radius: 4px; cursor: pointer; width: 100%;";
    bottomExportBtn.addEventListener("click", async () => {
      const selectedCheckboxes = container.querySelectorAll("label > input[type='checkbox']:checked");
      const selectedObjects = [];
      selectedCheckboxes.forEach(cb => {
        const apiName = cb.value;
        const correspondingObj = objects.find(o => o.objectApiName === apiName);
        if (correspondingObj) {
          selectedObjects.push(correspondingObj);
        }
      });
      document.body.removeChild(modal);
      await exportSelectedObjectsToXLSX(selectedObjects);
    });
    container.appendChild(bottomExportBtn);
    
    modal.appendChild(container);
    hideSpinner(); // Hide spinner once modal is ready
    document.body.appendChild(modal);
  } catch (error) {
    console.error("Error showing export selection modal:", error);
    hideSpinner();
  }
}

// ---------------------
// Main Flow
// ---------------------

async function initPicklistProcessing() {
  if (!window.location.pathname.includes("/lightning/setup/")) return;
  
  if (isObjectManagerHomePage()) {
    (async () => {
      try {
        const tableBody = await waitForElement("table tbody");
        const scrollable = findScrollableParent(tableBody);
        if (scrollable) {
          await autoScrollAndWait(scrollable);
          console.log("Auto scrolling finished for home page.");
        }
        const container = await waitForElement(".objectManagerGlobalSearchBox, div[role='search']");
        container.style.display = "flex";
        container.style.alignItems = "center";
        container.style.justifyContent = "flex-end";
        let input = container.querySelector("input[type='search']");
        if (input) {
          setupCustomQuickFind(input);
        }
        if (!document.getElementById("exportSelectionButton")) {
          const selectionButton = document.createElement("button");
          selectionButton.id = "exportSelectionButton";
          selectionButton.textContent = "Select Objects to Export";
          selectionButton.style.cssText =
            "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
          // Wrap the call in an async function to show spinner while modal loads.
          selectionButton.addEventListener("click", async () => {
            await showExportSelectionModal();
          });
          container.appendChild(selectionButton);
        }
        console.log("Home page initialization complete.");
      } catch (error) {
        console.error("Error during home page initialization:", error);
      }
    })();
    return;
  }
  
  removeSetupHomeModules();
  (async () => {
    const objectName = await getObjectApiNameFromURL();
    if (objectName && lastObjectName && lastObjectName !== objectName) {
      const existing = document.getElementById("customQuickFind");
      if (existing) existing.remove();
    }
    lastObjectName = objectName;
  
    let originalQuickFind;
    try {
      originalQuickFind = await getOriginalQuickFind();
      console.log("Found original Quick Find.");
    } catch (error) {
      console.warn("Quick Find not found, will use fallback if on FieldsAndRelationships page.");
    }
    try {
      const tableBody = await waitForElement("table tbody");
      const scrollable = findScrollableParent(tableBody);
      if (scrollable) {
        await autoScrollAndWait(scrollable);
        console.log("Auto scrolling finished on detail page.");
      }
      
      if (originalQuickFind) {
        setupCustomQuickFind(originalQuickFind);
      } else if (window.location.pathname.includes("FieldsAndRelationships")) {
        if (!document.getElementById("exportDetailXLSXButton")) {
          const fallbackContainer = document.querySelector(".objectManagerGlobalSearchBox, div[role='search']") 
                                || document.querySelector(".setupHeader, .header") 
                                || document.body;
          const exportButton = document.createElement("button");
          exportButton.id = "exportDetailXLSXButton";
          exportButton.textContent = "Export XLSX";
          exportButton.style.cssText =
            "background-color: #0070d2; color: white; border: none; border-radius: 4px; padding: 5px 10px; font-size: 14px; cursor: pointer; margin-left: 10px;";
          exportButton.addEventListener("click", exportCurrentObjectFieldsToXLSX);
          fallbackContainer.appendChild(exportButton);
        }
      }
      
      processPicklistRows();
      
      const observer = new MutationObserver(mutations => {
        if (mutations.some(m => m.addedNodes.length)) {
          processPicklistRows();
        }
      });
      observer.observe(tableBody, { childList: true });
      
      console.log("Detail page initialization complete.");
    } catch (error) {
      console.error("Error during detail page initialization:", error);
    }
  })();
}

let lastObjectName = null;

window.addEventListener("location-changed", () => {
  console.log("location-changed event detected.");
  lastObjectName = null;
  setTimeout(initPicklistProcessing, 500);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "location-changed") {
    console.log("Received location-changed from background.");
    lastObjectName = null;
    setTimeout(initPicklistProcessing, 500);
  }
});

initPicklistProcessing().catch(console.error);
