export type CompanyRole = 'Owner' | 'Admin' | 'Moderator' | 'Member' | 'Guest';

export interface CompanyMember {
  user_id: string;
  username: string;
  role: CompanyRole;
  joined_at: string;
  avatar_url?: string;
  last_active_at?: string;
  total_active_seconds?: number;
  daily_active_seconds?: Record<string, number>;
}


export interface EnrolledPasskey {
  id: string;
  label: string;
  hash: string;
  created_at: string;
}

export interface UserProfile {
  id: string;
  username: string;
  created_at: string;
  company_ids: string[];
  avatar_url?: string;
  last_active_at?: string;
  total_active_seconds?: number;
  has_passkey?: boolean;
  enrolled_passkeys?: EnrolledPasskey[];
  daily_active_seconds?: Record<string, number>;
}



export interface Company {
  id: string;
  name: string;
  join_code: string;
  owner_id: string;
  created_at: string;
  last_activity_at?: string;
  member_ids: string[];
  members?: CompanyMember[];
  is_public?: boolean;

  logo_url?: string;
  public_headline?: string;
  public_description?: string;
  public_faqs?: string;
  otp_passcode?: string;
  otp_expires_at?: string;
}



export interface Team {
  id: string;
  company_id: string;
  name: string;
  description: string;
  created_at: string;
}

export interface MessageReaction {
  username: string;
  emoji: string;
}

export interface ChatMessage {
  id: string;
  company_id: string;
  team_id?: string;
  user_id: string;
  username: string;
  message: string;
  file_attachment?: {
    name: string;
    url: string;
    file_type: string;
    size: number;
  };
  reactions?: MessageReaction[];
  timestamp: string;
}

export interface WorkspaceAsset {
  id: string;
  company_id: string;
  team_id?: string;
  asset_type: 'whiteboard' | 'spreadsheet' | 'doc' | 'pdf' | 'file' | 'folder';
  name: string;
  content?: string;
  created_by: string;
  updated_at: string;
  folder_id?: string | null;
  folder_path?: string;
  parent_id?: string | null;
  file_type?: string;
  size?: number;
  url?: string;
  scope?: 'shared' | 'private' | 'dm';
  allowed_users?: string[] | null;
}

export interface CallParticipant {
  user_id: string;
  username: string;
  is_audio_muted: boolean;
  is_video_off: boolean;
  is_screen_sharing: boolean;
  joined_at: string;
}

export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';

export interface TaskItem {
  id: string;
  company_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string;
  creator: string;
  created_at: string;
  updated_at: string;
  due_date?: string;
  tags?: string[];
}

export type ActiveTab = 'overview' | 'teams' | 'assets' | 'terminal' | 'tasks' | 'browser' | 'rdp' | 'whiteboard' | 'spreadsheet' | 'docs' | 'activity';


