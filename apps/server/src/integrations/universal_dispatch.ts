import type { IntegrationWriteRequest, IntegrationWriteResult } from "./integration_interface";
import { writeSalesforceNote } from "./salesforce_stub";
import { writeHubspotNote } from "./hubspot_stub";
import { writeZoomEvent } from "./zoom_stub";
import { writeGoogleMeetEvent } from "./google_meet_stub";
import { writeGoogleWorkspaceEvent } from "./google_workspace_stub";
import { writeBluetoothBridgeEvent } from "./bluetooth_bridge_stub";
import { writeServerWebhookEvent } from "./server_webhook_stub";

export async function dispatchIntegrationEvent(req: IntegrationWriteRequest): Promise<IntegrationWriteResult> {
  if (req.integration === "salesforce") return writeSalesforceNote(req);
  if (req.integration === "hubspot") return writeHubspotNote(req);
  if (req.integration === "zoom") return writeZoomEvent(req);
  if (req.integration === "google_meet") return writeGoogleMeetEvent(req);
  if (req.integration === "google_workspace") return writeGoogleWorkspaceEvent(req);
  if (req.integration === "bluetooth_bridge") return writeBluetoothBridgeEvent(req);
  return writeServerWebhookEvent(req);
}
