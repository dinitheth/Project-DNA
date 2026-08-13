import { useEffect } from 'react';
import { ExtensionMessageSchema, type ExtensionMessage } from '@project-dna/shared';

export function createExtensionMessageListener(
  handler: (message: ExtensionMessage) => void,
): (event: MessageEvent<unknown>) => void {
  return (event) => {
    const parsed = ExtensionMessageSchema.safeParse(event.data);
    if (parsed.success) handler(parsed.data);
  };
}

export function useMessage(handler: (message: ExtensionMessage) => void): void {
  useEffect(() => {
    const handleMessage = createExtensionMessageListener(handler);

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handler]);
}
