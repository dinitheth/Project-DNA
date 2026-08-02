import { useEffect } from 'react';

export function useMessage(handler: (message: any) => void) {
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      handler(event.data);
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handler]);
}
