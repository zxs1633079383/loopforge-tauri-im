use helix_core::effect::TransportId;
use helix_core::ports::Transport;
use helix_core::PortError;
use helix_driver_instrument::{InstrumentCtx, Recording};
use helix_driver_native::NativeTransport;
use tokio::sync::mpsc;

pub async fn connect_recording_transport(
    ws_url: String,
    transport_id: TransportId,
    tick_tx: mpsc::Sender<helix_core::Tick>,
    ws_headers: Vec<(String, String)>,
    ctx: InstrumentCtx,
) -> Result<Recording<NativeTransport>, PortError> {
    let mut transport = NativeTransport::new(ws_url, transport_id, Some(tick_tx))
        .with_handshake_headers(ws_headers);
    transport.connect().await?;
    Ok(Recording::new(transport, ctx))
}
