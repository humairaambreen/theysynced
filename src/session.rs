use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

#[derive(Clone)]
pub struct Session {
    pub id: String,
    pub company_id: String,
    pub name: String,
    pub state: Arc<RwLock<SessionState>>,
    pub broadcast: broadcast::Sender<String>,
    pub user_count: Arc<AtomicUsize>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionState {
    pub draw_actions: Vec<serde_json::Value>,
    pub excalidraw_elements: Vec<serde_json::Value>,
    pub cursors: HashMap<String, CursorPosition>,
    pub chat_messages: Vec<ChatMessage>,
    pub spreadsheet_data: HashMap<String, String>, // e.g. "A1" -> "Value/Formula"
    pub spreadsheet_grid: Vec<Vec<String>>,

    pub document_content: String,
    pub active_call_participants: HashMap<String, CallParticipant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallParticipant {
    pub user_id: String,
    pub username: String,
    pub is_audio_muted: bool,
    pub is_video_off: bool,
    pub is_screen_sharing: bool,
    pub joined_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageReaction {
    pub username: String,
    pub emoji: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub company_id: String,
    pub team_id: Option<String>,
    pub user_id: String,
    pub username: String,
    pub message: String,
    pub file_attachment: Option<FileAttachment>,
    pub reactions: Option<Vec<MessageReaction>>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileAttachment {
    pub name: String,
    pub url: String,
    pub file_type: String,
    pub size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorPosition {
    pub x: f64,
    pub y: f64,
    pub user_id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

