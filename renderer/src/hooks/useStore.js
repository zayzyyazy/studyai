import { useState, useEffect, useCallback } from 'react';

export function useStore() {
  const [state, setState] = useState({
    apiKey: '',
    vaultPath: '',
    courses: [],
    onboardingComplete: false
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.storeGetAll().then(data => {
      setState(data);
      setLoading(false);
    });
  }, []);

  const update = useCallback(async (key, value) => {
    await window.api.storeSet(key, value);
    setState(prev => ({ ...prev, [key]: value }));
  }, []);

  const refresh = useCallback(async () => {
    const data = await window.api.storeGetAll();
    setState(data);
  }, []);

  return { state, loading, update, refresh };
}
