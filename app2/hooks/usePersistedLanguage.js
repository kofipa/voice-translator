import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT = { code: 'en', label: 'English' };

export function usePersistedLanguage(storageKey = '@voice_translator_language') {
  const [language, setLanguage] = useState(DEFAULT);

  // Load on mount
  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then(val => { if (val) setLanguage(JSON.parse(val)); })
      .catch(() => {});
  }, [storageKey]);

  // Save and update
  function setAndPersist(lang) {
    setLanguage(lang);
    AsyncStorage.setItem(storageKey, JSON.stringify(lang)).catch(() => {});
  }

  return [language, setAndPersist];
}
