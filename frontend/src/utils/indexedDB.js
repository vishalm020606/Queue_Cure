const DB_NAME = 'queue_cure_local';
const DB_VERSION = 1;

export const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Store local copy of patient profiles
      if (!db.objectStoreNames.contains('patients')) {
        db.createObjectStore('patients', { keyPath: '_id' });
      }

      // Store local copy of visits (active queue)
      if (!db.objectStoreNames.contains('visits')) {
        db.createObjectStore('visits', { keyPath: '_id' });
      }

      // Store local copy of historical consultations
      if (!db.objectStoreNames.contains('consultations')) {
        db.createObjectStore('consultations', { keyPath: '_id' });
      }

      // Store pending action logs to replay upon reconnection
      if (!db.objectStoreNames.contains('pendingActions')) {
        db.createObjectStore('pendingActions', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
};

export const saveItem = async (storeName, item) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(item);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
};

export const getAllItems = async (storeName) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
};

export const deleteItem = async (storeName, key) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
};

export const clearStore = async (storeName) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
};

export const addPendingAction = async (type, data) => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pendingActions', 'readwrite');
    const store = tx.objectStore('pendingActions');
    const action = {
      type,
      data,
      timestamp: Date.now()
    };
    const request = store.add(action);

    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
  });
};

export const getPendingActions = async () => {
  return await getAllItems('pendingActions');
};

// Replays offline transactions in order and maps client-side temporary IDs
export const synchronizePendingActions = async (backendUrl, token, onProgress) => {
  const actions = await getPendingActions();
  if (actions.length === 0) return { success: true, count: 0 };

  const idMap = {};
  let processed = 0;

  for (const action of actions) {
    if (onProgress) onProgress(processed, actions.length, action.type);
    console.log(`[Sync Engine] Replaying action: ${action.type}`, action.data);

    try {
      if (action.type === 'REGISTER_PATIENT') {
        const response = await fetch(`${backendUrl}/api/register-patient`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(action.data)
        });
        const result = await response.json();
        
        if (response.ok && result.success) {
          // Record temporary -> permanent database ID mapping
          idMap[action.data.tempId] = result.patient._id;
          
          // Replace temp patient profile in cache with MongoDB data
          await deleteItem('patients', action.data.tempId);
          await saveItem('patients', result.patient);
        } else {
          throw new Error(result.error || 'Failed to register patient profile.');
        }
      } 
      
      else if (action.type === 'ADD_VISIT') {
        // Resolve patient ID mapping if registered offline
        let patientId = action.data.patientId;
        if (idMap[patientId]) {
          patientId = idMap[patientId];
        }

        const response = await fetch(`${backendUrl}/api/add-visit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            patientId,
            reasonForVisit: action.data.reasonForVisit,
            priority: action.data.priority
          })
        });
        const result = await response.json();

        if (response.ok && result.success) {
          // Record temporary -> permanent ID mapping
          idMap[action.data.tempId] = result.visit._id;
          
          await deleteItem('visits', action.data.tempId);
          await saveItem('visits', result.visit);
        } else {
          throw new Error(result.error || 'Failed to queue patient visit.');
        }
      } 
      
      else if (action.type === 'SUBMIT_CONSULTATION') {
        // Map references
        let patientId = action.data.patientId;
        let visitId = action.data.visitId;
        if (idMap[patientId]) patientId = idMap[patientId];
        if (idMap[visitId]) visitId = idMap[visitId];

        const response = await fetch(`${backendUrl}/api/consultation/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            visitId,
            patientId,
            symptoms: action.data.symptoms,
            diagnosis: action.data.diagnosis,
            prescription: action.data.prescription,
            notes: action.data.notes,
            followUpDate: action.data.followUpDate
          })
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || 'Failed to save consultation chart.');
        }
      }

      // Remove this successfully replayed log from queue
      await deleteItem('pendingActions', action.id);
      processed++;
    } catch (err) {
      console.error(`[Sync Engine Error] Aborting replay queue on action ${action.id}:`, err.message);
      return { success: false, error: err.message, processed };
    }
  }

  return { success: true, count: processed };
};
