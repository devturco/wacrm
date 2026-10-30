// ============================================================
// Sample payloads, shown in the CRMBR settings screen next to the
// event checkboxes ("Ver exemplo JSON"). They mirror the shapes in
// docs/whatsmiau.md so a user can see exactly what we subscribe to.
// ============================================================

export const WEBHOOK_EVENT_SAMPLES: Record<string, string> = {
  'messages.upsert': `{
  "event": "messages.upsert",
  "instance": "Atendimento01",
  "date_time": "2026-10-27T15:00:00Z",
  "data": {
    "key": { "remoteJid": "5511999988888@s.whatsapp.net", "id": "MSG_001", "fromMe": false },
    "pushName": "Cliente Exemplo",
    "status": "received",
    "message": { "conversation": "Preciso de suporte." },
    "messageType": "conversation",
    "messageTimestamp": 1793113200,
    "instanceId": "Atendimento01"
  }
}`,
  'messages.edited': `{
  "event": "messages.edited",
  "instance": "Atendimento01",
  "date_time": "2026-10-27T15:02:00Z",
  "data": {
    "key": { "remoteJid": "5511999988888@s.whatsapp.net", "id": "MSG_001", "fromMe": false },
    "editedMessage": { "conversation": "Preciso de suporte técnico." },
    "messageType": "conversation",
    "pushName": "Cliente Exemplo",
    "status": "received",
    "messageTimestamp": 1793113320,
    "source": "whatsapp",
    "instanceId": "Atendimento01"
  }
}`,
  'messages.update': `{
  "event": "messages.update",
  "instance": "Atendimento01",
  "data": {
    "messageId": "MSG_001",
    "keyId": "MSG_001",
    "remoteJid": "5511999988888@s.whatsapp.net",
    "fromMe": true,
    "status": "READ",
    "instanceId": "Atendimento01"
  }
}`,
  'messages.delete': `{
  "event": "messages.delete",
  "instance": "Atendimento01",
  "data": {
    "id": "MSG_001",
    "remoteJid": "5511999988888@s.whatsapp.net",
    "fromMe": false,
    "status": "DELETED",
    "instanceId": "Atendimento01"
  }
}`,
  'connection.update': `{
  "event": "connection.update",
  "instance": "Atendimento01",
  "data": {
    "instance": "Atendimento01",
    "wuid": "5511999988888@s.whatsapp.net",
    "profileName": "Equipe",
    "state": "open",
    "statusReason": 200
  }
}`,
  'contacts.upsert': `{
  "event": "contacts.upsert",
  "instance": "Atendimento01",
  "date_time": "2026-10-27T15:05:00Z",
  "data": [
    {
      "remoteJid": "5511999988888@s.whatsapp.net",
      "remoteLid": "111222333444555@s.whatsapp.net",
      "pushName": "Cliente Exemplo",
      "profilePicUrl": "https://cdn.whatsapp.net/profile.jpg",
      "instanceId": "Atendimento01"
    }
  ]
}`,
};

/** Every event we know how to handle, in the order we show them. */
export const WEBHOOK_EVENT_ORDER = [
  'messages.upsert',
  'messages.edited',
  'messages.update',
  'messages.delete',
  'connection.update',
  'contacts.upsert',
] as const;
