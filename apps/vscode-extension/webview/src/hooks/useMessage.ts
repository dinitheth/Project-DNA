import { useEffect } from 'react';
import { ExtensionMessageSchema, type ExtensionMessage } from '@project-dna/shared';

export function useMessage(handler: (message: ExtensionMessage) => void): void {
  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const parsed = ExtensionMessageSchema.safeParse(event.data);
      if (parsed.success) handler(parsed.data);
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handler]);
}
