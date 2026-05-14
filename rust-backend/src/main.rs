use std::{collections::HashMap, env, net::SocketAddr, sync::Arc, time::Duration};

use anyhow::{anyhow, Context};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{header::HeaderValue, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use futures::{SinkExt, StreamExt};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use tokio::sync::{mpsc, RwLock};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    config: Config,
    db: PgPool,
    http: Client,
    sockets: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<Message>>>>,
}

#[derive(Clone)]
struct Config {
    database_url: String,
    firebase_project_id: String,
    fcm_project_id: String,
    firebase_service_account_json: String,
    frontend_url: String,
    cors_allowed_origins: Vec<String>,
    bind_addr: String,
}

impl Config {
    fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            database_url: env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            firebase_project_id: env::var("FIREBASE_PROJECT_ID")
                .context("FIREBASE_PROJECT_ID is required")?,
            fcm_project_id: env::var("FCM_PROJECT_ID")
                .or_else(|_| env::var("FIREBASE_PROJECT_ID"))
                .context("FCM_PROJECT_ID or FIREBASE_PROJECT_ID is required")?,
            firebase_service_account_json: env::var("FIREBASE_SERVICE_ACCOUNT_JSON")
                .context("FIREBASE_SERVICE_ACCOUNT_JSON is required")?,
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "https://comms1.vercel.app".to_string()),
            cors_allowed_origins: env::var("CORS_ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:8080,https://comms1.vercel.app".to_string())
                .split(',')
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect(),
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".to_string()),
        })
    }
}

#[derive(Debug, thiserror::Error)]
enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            ApiError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
            ApiError::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden"),
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error"),
        };
        let body = Json(json!({ "error": { "code": code, "message": self.to_string() } }));
        (status, body).into_response()
    }
}

#[derive(Debug, Deserialize)]
struct RegisterDeviceRequest {
    platform: String,
    provider: String,
    token: String,
    #[serde(rename = "userAgent")]
    user_agent: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UnregisterRequest {
    token: String,
}

#[derive(Debug, Deserialize)]
struct MessagePushRequest {
    #[serde(rename = "messageId")]
    message_id: Uuid,
}

#[derive(Debug, Serialize, Deserialize)]
struct PreferencesDto {
    #[serde(rename = "messagesEnabled")]
    messages_enabled: bool,
    #[serde(rename = "callsEnabled")]
    calls_enabled: bool,
    #[serde(rename = "missedCallsEnabled")]
    missed_calls_enabled: bool,
    #[serde(rename = "showMessagePreview")]
    show_message_preview: bool,
    #[serde(rename = "soundEnabled")]
    sound_enabled: bool,
}

#[derive(Debug, Deserialize)]
struct WsQuery {
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ClientWsEvent {
    #[serde(rename = "call_start")]
    CallStart {
        #[serde(default)]
        #[serde(rename = "receiverId")]
        receiver_id: Option<String>,
        #[serde(rename = "conversationId")]
        conversation_id: Option<Uuid>,
        mode: String,
    },
    #[serde(rename = "call_accept")]
    CallAccept { #[serde(rename = "callId")] call_id: Uuid },
    #[serde(rename = "call_reject")]
    CallReject { #[serde(rename = "callId")] call_id: Uuid },
    #[serde(rename = "call_end")]
    CallEnd { #[serde(rename = "callId")] call_id: Uuid },
    #[serde(rename = "webrtc_offer")]
    WebrtcOffer {
        #[serde(rename = "callId")]
        call_id: Uuid,
        #[serde(rename = "toUserId")]
        to_user_id: String,
        sdp: String,
    },
    #[serde(rename = "webrtc_answer")]
    WebrtcAnswer {
        #[serde(rename = "callId")]
        call_id: Uuid,
        #[serde(rename = "toUserId")]
        to_user_id: String,
        sdp: String,
    },
    #[serde(rename = "ice_candidate")]
    IceCandidate {
        #[serde(rename = "callId")]
        call_id: Uuid,
        #[serde(rename = "toUserId")]
        to_user_id: String,
        candidate: Value,
    },
}

#[derive(Serialize)]
struct CallStatusDto {
    #[serde(rename = "callId")]
    call_id: Uuid,
    status: String,
    #[serde(rename = "callerId")]
    caller_id: String,
    #[serde(rename = "receiverId")]
    receiver_id: Option<String>,
    mode: String,
    #[serde(rename = "expiresAt")]
    expires_at: DateTime<Utc>,
    #[serde(rename = "canJoin")]
    can_join: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    tracing::info!(frontend_url = %config.frontend_url, "COMMS frontend configured");
    let db = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;
    let state = AppState {
        config: config.clone(),
        db,
        http: Client::new(),
        sockets: Arc::new(RwLock::new(HashMap::new())),
    };
    spawn_missed_call_worker(state.clone());

    let allowed_origins: Vec<HeaderValue> = config
        .cors_allowed_origins
        .iter()
        .filter_map(|origin| origin.parse::<HeaderValue>().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any)
        .allow_origin(AllowOrigin::list(allowed_origins));

    let app = Router::new()
        .route("/health", get(|| async { Json(json!({ "ok": true })) }))
        .route("/api/notifications/register", post(register_device))
        .route("/api/notifications/unregister", post(unregister_device))
        .route("/api/notifications/preferences", get(get_preferences).patch(patch_preferences))
        .route("/api/notifications/test", post(test_notification))
        .route("/api/notifications/message-push", post(message_push))
        .route("/api/calls/:call_id/status", get(call_status))
        .route("/ws", get(ws_handler))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = config.bind_addr.parse()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("COMMS Rust backend listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn firebase_user(headers: &HeaderMap, state: &AppState) -> Result<String, ApiError> {
    let header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::Unauthorized("Missing authorization header.".to_string()))?;
    let token = header
        .strip_prefix("Bearer ")
        .ok_or_else(|| ApiError::Unauthorized("Invalid authorization header.".to_string()))?;
    verify_firebase_id_token(token, state).await
}

async fn verify_firebase_id_token(token: &str, state: &AppState) -> Result<String, ApiError> {
    #[derive(Clone, Deserialize)]
    struct Claims {
        sub: String,
        aud: String,
        iss: String,
        exp: usize,
    }
    let header = jsonwebtoken::decode_header(token)
        .map_err(|_| ApiError::Unauthorized("Invalid Firebase token.".to_string()))?;
    let kid = header
        .kid
        .ok_or_else(|| ApiError::Unauthorized("Firebase token is missing kid.".to_string()))?;
    #[derive(Deserialize)]
    struct JwkSet {
        keys: Vec<Jwk>,
    }
    #[derive(Deserialize)]
    struct Jwk {
        kid: String,
        n: String,
        e: String,
    }
    let jwks: JwkSet = state
        .http
        .get("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
        .send()
        .await
        .map_err(|_| ApiError::Unauthorized("Could not fetch Firebase signing keys.".to_string()))?
        .json()
        .await
        .map_err(|_| ApiError::Unauthorized("Could not read Firebase signing keys.".to_string()))?;
    let jwk = jwks
        .keys
        .into_iter()
        .find(|key| key.kid == kid)
        .ok_or_else(|| ApiError::Unauthorized("Firebase signing key was not found.".to_string()))?;
    let key = DecodingKey::from_rsa_components(&jwk.n, &jwk.e)
        .map_err(|_| ApiError::Unauthorized("Firebase signing key is invalid.".to_string()))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[state.config.firebase_project_id.as_str()]);
    let issuer = format!(
        "https://securetoken.google.com/{}",
        state.config.firebase_project_id
    );
    validation.set_issuer(&[issuer.as_str()]);
    let data = decode::<Claims>(token, &key, &validation)
        .map_err(|_| ApiError::Unauthorized("Firebase token verification failed.".to_string()))?;
    Ok(data.claims.sub)
}

async fn register_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RegisterDeviceRequest>,
) -> Result<Json<Value>, ApiError> {
    let user_id = firebase_user(&headers, &state).await?;
    if req.platform != "web_pwa" || req.provider != "fcm" {
        return Err(ApiError::BadRequest("Only web_pwa/fcm devices are supported.".to_string()));
    }
    sqlx::query(
        r#"
        insert into notification_devices (user_id, platform, provider, token, enabled, user_agent, last_seen_at, updated_at)
        values ($1, $2, $3, $4, true, $5, now(), now())
        on conflict (provider, token) do update set
          user_id = excluded.user_id,
          platform = excluded.platform,
          enabled = true,
          user_agent = excluded.user_agent,
          last_seen_at = now(),
          updated_at = now()
        "#,
    )
    .bind(user_id)
    .bind(req.platform)
    .bind(req.provider)
    .bind(req.token)
    .bind(req.user_agent)
    .execute(&state.db)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(json!({ "ok": true })))
}

async fn unregister_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UnregisterRequest>,
) -> Result<Json<Value>, ApiError> {
    let user_id = firebase_user(&headers, &state).await?;
    sqlx::query("update notification_devices set enabled = false, updated_at = now() where user_id = $1 and token = $2")
        .bind(user_id)
        .bind(req.token)
        .execute(&state.db)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(json!({ "ok": true })))
}

async fn get_preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PreferencesDto>, ApiError> {
    let user_id = firebase_user(&headers, &state).await?;
    let prefs = ensure_preferences(&state.db, &user_id).await?;
    Ok(Json(prefs))
}

async fn patch_preferences(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PreferencesDto>,
) -> Result<Json<PreferencesDto>, ApiError> {
    let user_id = firebase_user(&headers, &state).await?;
    let row = sqlx::query(
        r#"
        insert into notification_preferences
          (user_id, messages_enabled, calls_enabled, missed_calls_enabled, show_message_preview, sound_enabled, updated_at)
        values ($1, $2, $3, $4, $5, $6, now())
        on conflict (user_id) do update set
          messages_enabled = excluded.messages_enabled,
          calls_enabled = excluded.calls_enabled,
          missed_calls_enabled = excluded.missed_calls_enabled,
          show_message_preview = excluded.show_message_preview,
          sound_enabled = excluded.sound_enabled,
          updated_at = now()
        returning messages_enabled, calls_enabled, missed_calls_enabled, show_message_preview, sound_enabled
        "#,
    )
    .bind(&user_id)
    .bind(req.messages_enabled)
    .bind(req.calls_enabled)
    .bind(req.missed_calls_enabled)
    .bind(req.show_message_preview)
    .bind(req.sound_enabled)
    .fetch_one(&state.db)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(row_to_preferences(row)))
}

async fn ensure_preferences(db: &PgPool, user_id: &str) -> Result<PreferencesDto, ApiError> {
    let row = sqlx::query(
        r#"
        insert into notification_preferences (user_id)
        values ($1)
        on conflict (user_id) do update set user_id = excluded.user_id
        returning messages_enabled, calls_enabled, missed_calls_enabled, show_message_preview, sound_enabled
        "#,
    )
    .bind(user_id)
    .fetch_one(db)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(row_to_preferences(row))
}

fn row_to_preferences(row: sqlx::postgres::PgRow) -> PreferencesDto {
    PreferencesDto {
        messages_enabled: row.get("messages_enabled"),
        calls_enabled: row.get("calls_enabled"),
        missed_calls_enabled: row.get("missed_calls_enabled"),
        show_message_preview: row.get("show_message_preview"),
        sound_enabled: row.get("sound_enabled"),
    }
}

async fn test_notification(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let user_id = firebase_user(&headers, &state).await?;
    let payload = json!({
        "type": "message",
        "title": "COMMS",
        "body": "Test notification",
        "targetUrl": "/app",
        "tag": "comms-test",
        "privacy": "normal"
    });
    send_to_user_devices(&state, &user_id, "test", None, payload).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn message_push(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<MessagePushRequest>,
) -> Result<Json<Value>, ApiError> {
    let sender_user_id = firebase_user(&headers, &state).await?;
    let message = sqlx::query(
        r#"
        select m.id, m.conversation_id, m.sender_id, m.content, m.kind,
               c.type as conversation_type, c.title as conversation_title
        from messages m
        join conversations c on c.id = m.conversation_id
        where m.id = $1 and m.deleted_for_everyone_at is null
        "#,
    )
    .bind(req.message_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?
    .ok_or_else(|| ApiError::NotFound("Message was not found.".to_string()))?;
    let sender_id: String = message.get("sender_id");
    if sender_id != sender_user_id {
        return Err(ApiError::Forbidden("Only the sender can notify this message.".to_string()));
    }
    let conversation_id: Uuid = message.get("conversation_id");
    let recipients = sqlx::query(
        r#"
        select cm.user_id
        from conversation_members cm
        where cm.conversation_id = $1 and cm.user_id <> $2
        union
        select user_two_id from conversations where id = $1 and user_one_id = $2 and user_two_id is not null
        union
        select user_one_id from conversations where id = $1 and user_two_id = $2 and user_one_id is not null
        "#,
    )
    .bind(conversation_id)
    .bind(&sender_id)
    .fetch_all(&state.db)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    let sender_name = display_name(&state.db, &sender_id).await.unwrap_or_else(|_| "COMMS".to_string());
    let content: Option<String> = message.get("content");
    for row in recipients {
        let recipient_id: String = row.get("user_id");
        if message_should_skip(&state.db, &recipient_id, &sender_id, conversation_id).await? {
            log_event(&state.db, &recipient_id, "message", Some(&req.message_id.to_string()), "skipped", Some("muted_or_blocked")).await;
            continue;
        }
        let prefs = ensure_preferences(&state.db, &recipient_id).await?;
        if !prefs.messages_enabled {
            log_event(&state.db, &recipient_id, "message", Some(&req.message_id.to_string()), "skipped", Some("messages_disabled")).await;
            continue;
        }
        let protected = !prefs.show_message_preview;
        let payload = if protected {
            json!({
                "type": "message",
                "title": "COMMS",
                "body": "New message",
                "conversationId": conversation_id.to_string(),
                "messageId": req.message_id.to_string(),
                "targetUrl": "/app",
                "tag": "comms-protected-message",
                "privacy": "protected"
            })
        } else {
            json!({
                "type": "message",
                "title": sender_name,
                "body": content.clone().unwrap_or_else(|| "New attachment".to_string()),
                "conversationId": conversation_id.to_string(),
                "messageId": req.message_id.to_string(),
                "targetUrl": format!("/chats/{conversation_id}?messageId={}", req.message_id),
                "tag": format!("chat-{conversation_id}"),
                "privacy": "normal"
            })
        };
        send_to_user_devices(&state, &recipient_id, "message", Some(req.message_id.to_string()), payload).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn message_should_skip(
    db: &PgPool,
    recipient_id: &str,
    sender_id: &str,
    conversation_id: Uuid,
) -> Result<bool, ApiError> {
    let row = sqlx::query(
        r#"
        select
          exists (
            select 1 from blocks
            where (blocker_id = $1 and blocked_id = $2)
               or (blocker_id = $2 and blocked_id = $1)
          ) as blocked,
          exists (
            select 1 from conversation_notification_settings
            where user_id = $1
              and conversation_id = $3
              and muted = true
              and (muted_until is null or muted_until > now())
          ) or exists (
            select 1 from conversation_mutes
            where user_id = $1
              and conversation_id = $3
              and (muted_until is null or muted_until > now())
          ) as muted
        "#,
    )
    .bind(recipient_id)
    .bind(sender_id)
    .bind(conversation_id)
    .fetch_one(db)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?;
    Ok(row.get::<bool, _>("blocked") || row.get::<bool, _>("muted"))
}

async fn call_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(call_id): Path<Uuid>,
) -> Result<Json<CallStatusDto>, ApiError> {
    let user_id = firebase_user(&headers, &state).await?;
    let row = sqlx::query(
        "select id, status, caller_id, coalesce(receiver_id, callee_id) as receiver_id, conversation_id, mode, expires_at from call_sessions where id = $1",
    )
    .bind(call_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| ApiError::Internal(e.into()))?
    .ok_or_else(|| ApiError::NotFound("Call was not found.".to_string()))?;
    let caller_id: String = row.get("caller_id");
    let receiver_id: Option<String> = row.get("receiver_id");
    let conversation_id: Option<Uuid> = row.get("conversation_id");
    let group_member = if let Some(conversation_id) = conversation_id {
        sqlx::query(
            "select exists(select 1 from conversation_members where conversation_id = $1 and user_id = $2) as member",
        )
        .bind(conversation_id)
        .bind(&user_id)
        .fetch_one(&state.db)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?
        .get::<bool, _>("member")
    } else {
        false
    };
    if caller_id != user_id && receiver_id.as_deref() != Some(user_id.as_str()) && !group_member {
        return Err(ApiError::Forbidden("You cannot access this call.".to_string()));
    }
    let status: String = row.get("status");
    let expires_at: DateTime<Utc> = row.get("expires_at");
    Ok(Json(CallStatusDto {
        call_id: row.get("id"),
        status: status.clone(),
        caller_id,
        receiver_id,
        mode: row.get("mode"),
        expires_at,
        can_join: status == "ringing" && expires_at > Utc::now(),
    }))
}

async fn ws_handler(
    State(state): State<AppState>,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let user_id = verify_firebase_id_token(&query.token, &state).await?;
    Ok(ws.on_upgrade(move |socket| ws_session(state, user_id, socket)))
}

async fn ws_session(state: AppState, user_id: String, socket: WebSocket) {
    let (mut sender, mut receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    state.sockets.write().await.insert(user_id.clone(), tx);

    let send_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sender.send(message).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(message)) = receiver.next().await {
        if let Message::Text(text) = message {
            if let Ok(event) = serde_json::from_str::<ClientWsEvent>(&text) {
                let _ = handle_ws_event(&state, &user_id, event).await;
            }
        }
    }
    state.sockets.write().await.remove(&user_id);
    send_task.abort();
}

async fn handle_ws_event(state: &AppState, user_id: &str, event: ClientWsEvent) -> anyhow::Result<()> {
    match event {
        ClientWsEvent::CallStart { receiver_id, conversation_id, mode } => {
            let call_id = Uuid::new_v4();
            let is_group_call = conversation_id.is_some() && receiver_id.is_none();
            let call_type = if is_group_call { "group" } else { "direct" };
            sqlx::query(
                r#"
                insert into call_sessions
                  (id, conversation_id, caller_id, receiver_id, callee_id, call_type, mode, status, expires_at, metadata)
                values ($1, $2, $3, $4, $4, $5, $6, 'ringing', now() + interval '45 seconds', '{}'::jsonb)
                "#,
            )
            .bind(call_id)
            .bind(conversation_id)
            .bind(user_id)
            .bind(&receiver_id)
            .bind(call_type)
            .bind(&mode)
            .execute(&state.db)
            .await?;
            let call = json!({ "id": call_id, "callerId": user_id, "receiverId": receiver_id, "conversationId": conversation_id, "callType": call_type, "mode": mode, "status": "ringing" });
            let recipients = call_recipients(state, user_id, receiver_id.as_deref(), conversation_id).await?;
            for recipient_id in recipients {
                if !send_ws(state, &recipient_id, json!({ "type": "incoming_call", "call": call })).await {
                    send_call_push(state, &recipient_id, user_id, call_id, conversation_id, false).await?;
                }
            }
        }
        ClientWsEvent::CallAccept { call_id } => {
            sqlx::query(
                r#"
                update call_sessions
                set status = 'accepted', accepted_at = coalesce(accepted_at, now())
                where id = $1
                  and (
                    coalesce(receiver_id, callee_id) = $2
                    or exists (
                      select 1 from conversation_members
                      where conversation_id = call_sessions.conversation_id
                        and user_id = $2
                    )
                  )
                "#,
            )
                .bind(call_id).bind(user_id).execute(&state.db).await?;
            notify_call_peer(state, call_id, user_id, "call_accepted").await?;
        }
        ClientWsEvent::CallReject { call_id } => {
            sqlx::query("update call_sessions set status = 'rejected', ended_at = now() where id = $1 and coalesce(receiver_id, callee_id) = $2")
                .bind(call_id).bind(user_id).execute(&state.db).await?;
            notify_call_peer(state, call_id, user_id, "call_rejected").await?;
        }
        ClientWsEvent::CallEnd { call_id } => {
            sqlx::query(
                r#"
                update call_sessions
                set status = 'ended', ended_at = now()
                where id = $1
                  and (
                    caller_id = $2
                    or coalesce(receiver_id, callee_id) = $2
                    or exists (
                      select 1 from conversation_members
                      where conversation_id = call_sessions.conversation_id
                        and user_id = $2
                        and role in ('owner', 'admin')
                    )
                  )
                "#,
            )
                .bind(call_id).bind(user_id).execute(&state.db).await?;
            notify_call_peer(state, call_id, user_id, "call_ended").await?;
        }
        ClientWsEvent::WebrtcOffer { call_id, to_user_id, sdp } => {
            relay(state, &to_user_id, json!({ "type": "webrtc_offer", "callId": call_id, "fromUserId": user_id, "sdp": sdp })).await;
        }
        ClientWsEvent::WebrtcAnswer { call_id, to_user_id, sdp } => {
            relay(state, &to_user_id, json!({ "type": "webrtc_answer", "callId": call_id, "fromUserId": user_id, "sdp": sdp })).await;
        }
        ClientWsEvent::IceCandidate { call_id, to_user_id, candidate } => {
            relay(state, &to_user_id, json!({ "type": "ice_candidate", "callId": call_id, "fromUserId": user_id, "candidate": candidate })).await;
        }
    }
    Ok(())
}

async fn send_ws(state: &AppState, user_id: &str, payload: Value) -> bool {
    let sockets = state.sockets.read().await;
    sockets
        .get(user_id)
        .map(|tx| tx.send(Message::Text(payload.to_string().into())).is_ok())
        .unwrap_or(false)
}

async fn relay(state: &AppState, to_user_id: &str, payload: Value) {
    let _ = send_ws(state, to_user_id, payload).await;
}

async fn notify_call_peer(state: &AppState, call_id: Uuid, actor_id: &str, event_type: &str) -> anyhow::Result<()> {
    let row = sqlx::query("select caller_id, coalesce(receiver_id, callee_id) as receiver_id, conversation_id from call_sessions where id = $1")
        .bind(call_id)
        .fetch_one(&state.db)
        .await?;
    let caller_id: String = row.get("caller_id");
    let receiver_id: Option<String> = row.get("receiver_id");
    let conversation_id: Option<Uuid> = row.get("conversation_id");
    let recipients = call_recipients(state, actor_id, receiver_id.as_deref(), conversation_id).await?;
    for recipient_id in recipients {
        let _ = send_ws(state, &recipient_id, json!({ "type": event_type, "callId": call_id })).await;
    }
    if caller_id != actor_id {
        let _ = send_ws(state, &caller_id, json!({ "type": event_type, "callId": call_id })).await;
    }
    Ok(())
}

async fn call_recipients(
    state: &AppState,
    caller_id: &str,
    receiver_id: Option<&str>,
    conversation_id: Option<Uuid>,
) -> anyhow::Result<Vec<String>> {
    if let Some(receiver_id) = receiver_id {
        if receiver_id != caller_id {
            return Ok(vec![receiver_id.to_string()]);
        }
        return Ok(Vec::new());
    }
    let Some(conversation_id) = conversation_id else {
        return Ok(Vec::new());
    };
    let rows = sqlx::query(
        "select user_id from conversation_members where conversation_id = $1 and user_id <> $2",
    )
    .bind(conversation_id)
    .bind(caller_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| row.get::<String, _>("user_id"))
        .collect())
}

async fn send_call_push(
    state: &AppState,
    recipient_id: &str,
    caller_id: &str,
    call_id: Uuid,
    conversation_id: Option<Uuid>,
    missed: bool,
) -> anyhow::Result<()> {
    let prefs = ensure_preferences(&state.db, recipient_id)
        .await
        .map_err(|e| anyhow!(e.to_string()))?;
    if (!missed && !prefs.calls_enabled) || (missed && !prefs.missed_calls_enabled) {
        log_event(
            &state.db,
            recipient_id,
            if missed { "missed_call" } else { "call" },
            Some(&call_id.to_string()),
            "skipped",
            Some("call_notifications_disabled"),
        )
        .await;
        return Ok(());
    }
    if users_blocked(&state.db, recipient_id, caller_id).await.unwrap_or(false) {
        log_event(
            &state.db,
            recipient_id,
            if missed { "missed_call" } else { "call" },
            Some(&call_id.to_string()),
            "skipped",
            Some("blocked"),
        )
        .await;
        return Ok(());
    }
    let caller_name = display_name(&state.db, caller_id).await.unwrap_or_else(|_| "Someone".to_string());
    let payload = if missed {
        json!({
            "type": "missed_call",
            "title": "Missed COMMS call",
            "body": format!("You missed a call from {caller_name}"),
            "callId": call_id.to_string(),
            "conversationId": conversation_id.map(|id| id.to_string()).unwrap_or_default(),
            "targetUrl": "/calls/history",
            "tag": format!("missed-call-{call_id}"),
            "privacy": "normal"
        })
    } else {
        json!({
            "type": "call",
            "title": "Incoming COMMS call",
            "body": format!("{caller_name} is calling"),
            "callId": call_id.to_string(),
            "conversationId": conversation_id.map(|id| id.to_string()).unwrap_or_default(),
            "targetUrl": format!("/calls/{call_id}"),
            "tag": format!("call-{call_id}"),
            "privacy": "normal"
        })
    };
    send_to_user_devices(state, recipient_id, if missed { "missed_call" } else { "call" }, Some(call_id.to_string()), payload).await.map_err(Into::into)
}

async fn users_blocked(db: &PgPool, a: &str, b: &str) -> anyhow::Result<bool> {
    let row = sqlx::query(
        "select exists (select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)) as blocked",
    )
    .bind(a)
    .bind(b)
    .fetch_one(db)
    .await?;
    Ok(row.get("blocked"))
}

async fn send_to_user_devices(
    state: &AppState,
    user_id: &str,
    notification_type: &str,
    target_id: Option<String>,
    payload: Value,
) -> Result<(), ApiError> {
    let rows = sqlx::query("select token from notification_devices where user_id = $1 and platform = 'web_pwa' and provider = 'fcm' and enabled = true")
        .bind(user_id)
        .fetch_all(&state.db)
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    if rows.is_empty() {
        log_event(&state.db, user_id, notification_type, target_id.as_deref(), "skipped", Some("no_enabled_devices")).await;
        return Ok(());
    }
    let access_token = oauth_access_token(state).await?;
    for row in rows {
        let token: String = row.get("token");
        let result = send_fcm_data(state, &access_token, &token, payload.clone()).await;
        match result {
            Ok(_) => log_event(&state.db, user_id, notification_type, target_id.as_deref(), "sent", None).await,
            Err(error) => {
                if error.to_string().contains("UNREGISTERED") {
                    let _ = sqlx::query("update notification_devices set enabled = false, updated_at = now() where token = $1")
                        .bind(&token).execute(&state.db).await;
                }
                log_event(&state.db, user_id, notification_type, target_id.as_deref(), "failed", Some(&error.to_string())).await;
            }
        }
    }
    Ok(())
}

async fn log_event(db: &PgPool, user_id: &str, notification_type: &str, target_id: Option<&str>, status: &str, reason: Option<&str>) {
    let _ = sqlx::query("insert into notification_events (user_id, notification_type, target_id, status, reason) values ($1, $2, $3, $4, $5)")
        .bind(user_id).bind(notification_type).bind(target_id).bind(status).bind(reason).execute(db).await;
}

async fn send_fcm_data(state: &AppState, access_token: &str, token: &str, data: Value) -> anyhow::Result<()> {
    let mut string_data = serde_json::Map::new();
    for (key, value) in data.as_object().cloned().unwrap_or_default() {
        string_data.insert(key, Value::String(value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string())));
    }
    let response = state
        .http
        .post(format!("https://fcm.googleapis.com/v1/projects/{}/messages:send", state.config.fcm_project_id))
        .bearer_auth(access_token)
        .json(&json!({ "message": { "token": token, "data": string_data } }))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(anyhow!("FCM send failed: {}", response.text().await.unwrap_or_default()));
    }
    Ok(())
}

#[derive(Deserialize)]
struct ServiceAccount {
    client_email: String,
    private_key: String,
    token_uri: String,
}

#[derive(Serialize)]
struct OAuthClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: i64,
    exp: i64,
}

async fn oauth_access_token(state: &AppState) -> Result<String, ApiError> {
    let account: ServiceAccount = serde_json::from_str(&state.config.firebase_service_account_json)
        .map_err(|e| ApiError::Internal(e.into()))?;
    let now = Utc::now().timestamp();
    let claims = OAuthClaims {
        iss: &account.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: &account.token_uri,
        iat: now,
        exp: now + 3600,
    };
    let key = EncodingKey::from_rsa_pem(account.private_key.as_bytes())
        .map_err(|e| ApiError::Internal(e.into()))?;
    let jwt = encode(&Header::new(Algorithm::RS256), &claims, &key)
        .map_err(|e| ApiError::Internal(e.into()))?;
    let response: Value = state
        .http
        .post(account.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", jwt.as_str()),
        ])
        .send()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?
        .json()
        .await
        .map_err(|e| ApiError::Internal(e.into()))?;
    response["access_token"]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| ApiError::Internal(anyhow!("OAuth access token missing")))
}

async fn display_name(db: &PgPool, user_id: &str) -> anyhow::Result<String> {
    let row = sqlx::query("select full_name, email from user_profiles where id = $1")
        .bind(user_id)
        .fetch_one(db)
        .await?;
    let name: String = row.get("full_name");
    let email: String = row.get("email");
    Ok(if name.trim().is_empty() { email } else { name })
}

fn spawn_missed_call_worker(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            if let Ok(rows) = sqlx::query(
                "update call_sessions set status = 'missed', ended_at = now() where status = 'ringing' and expires_at <= now() returning id, caller_id, coalesce(receiver_id, callee_id) as receiver_id, conversation_id"
            )
            .fetch_all(&state.db)
            .await
            {
                for row in rows {
                    let call_id: Uuid = row.get("id");
                    let caller_id: String = row.get("caller_id");
                    let receiver_id: Option<String> = row.get("receiver_id");
                    let conversation_id: Option<Uuid> = row.get("conversation_id");
                    let _ = send_ws(&state, &caller_id, json!({ "type": "call_missed", "callId": call_id })).await;
                    if let Ok(recipients) = call_recipients(
                        &state,
                        &caller_id,
                        receiver_id.as_deref(),
                        conversation_id,
                    )
                    .await
                    {
                        for receiver_id in recipients {
                            let _ = send_ws(&state, &receiver_id, json!({ "type": "call_missed", "callId": call_id })).await;
                            let _ = send_call_push(&state, &receiver_id, &caller_id, call_id, conversation_id, true).await;
                        }
                    }
                }
            }
        }
    });
}
