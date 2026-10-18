'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Company, UserProfile } from '../types';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  PhoneOff,
  Volume2,
  VolumeX,
  Monitor,
  Users,
  Radio,
  Sparkles,
  ShieldCheck,
  Signal,
  MessageSquare,
} from 'lucide-react';

interface VideoMeetingViewProps {
  user: UserProfile;
  company: Company;
  websocket: WebSocket | null;
}

interface Participant {
  user_id: string;
  username: string;
  is_audio_muted: boolean;
  is_video_off: boolean;
  is_speaking?: boolean;
  stream?: MediaStream;
}

export const VideoMeetingView: React.FC<VideoMeetingViewProps> = ({
  user,
  company,
  websocket,
}) => {
  const [activeChannel, setActiveChannel] = useState('General Voice');
  const [isInCall, setIsInCall] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const voiceChannels = [
    { id: 'General Voice', name: 'General Voice', type: 'audio' },
    { id: 'Lounge & Chill', name: 'Lounge & Chill', type: 'audio' },
    { id: 'Tech Standup', name: 'Tech Standup', type: 'audio' },
    { id: 'HD Video Call', name: 'HD Video Conference', type: 'video' },
  ];

  // Initialize WebRTC and Join Voice Channel
  const handleJoinCall = async (channelId: string) => {
    setActiveChannel(channelId);
    setIsInCall(true);

    try {
      // Request real local media stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: channelId === 'HD Video Call',
      });
      localStreamRef.current = stream;

      if (localVideoRef.current && channelId === 'HD Video Call') {
        localVideoRef.current.srcObject = stream;
      }

      // Add self to participants list
      const selfParticipant: Participant = {
        user_id: user.id,
        username: user.username,
        is_audio_muted: isAudioMuted,
        is_video_off: isVideoOff,
        stream,
      };

      setParticipants((prev) => {
        const filtered = prev.filter((p) => p.user_id !== user.id);
        return [selfParticipant, ...filtered];
      });

      // Send WS join signal
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(
          JSON.stringify({
            type: 'webrtc_join_call',
            room: channelId,
            muted: isAudioMuted,
            video_off: isVideoOff,
          })
        );
      }

      // Voice Activity Detection (Active Speaker green glow)
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const checkVolume = () => {
          if (!localStreamRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const average = sum / dataArray.length;
          const speaking = average > 15 && !isAudioMuted;

          setParticipants((prev) =>
            prev.map((p) => (p.user_id === user.id ? { ...p, is_speaking: speaking } : p))
          );
          requestAnimationFrame(checkVolume);
        };
        checkVolume();
      } catch (err) {
        // audio context optional
      }
    } catch (err) {
      console.warn('Microphone/Camera permission denied or unavailable:', err);
      // Fallback participant without media stream
      const selfParticipant: Participant = {
        user_id: user.id,
        username: user.username,
        is_audio_muted: true,
        is_video_off: true,
      };
      setParticipants((prev) => [selfParticipant, ...prev.filter((p) => p.user_id !== user.id)]);

      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(
          JSON.stringify({
            type: 'webrtc_join_call',
            room: channelId,
            muted: true,
            video_off: true,
          })
        );
      }
    }
  };

  const handleLeaveCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    if (websocket && websocket.readyState === WebSocket.OPEN) {
      websocket.send(JSON.stringify({ type: 'webrtc_leave_call', room: activeChannel }));
    }

    setIsInCall(false);
    setParticipants([]);
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = isAudioMuted));
    }
    const nextMuted = !isAudioMuted;
    setIsAudioMuted(nextMuted);
    setParticipants((prev) =>
      prev.map((p) => (p.user_id === user.id ? { ...p, is_audio_muted: nextMuted } : p))
    );
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((t) => (t.enabled = isVideoOff));
    }
    const nextVideoOff = !isVideoOff;
    setIsVideoOff(nextVideoOff);
    setParticipants((prev) =>
      prev.map((p) => (p.user_id === user.id ? { ...p, is_video_off: nextVideoOff } : p))
    );
  };

  const toggleDeafen = () => {
    setIsDeafened(!isDeafened);
  };

  // WebSockets signaling listener
  useEffect(() => {
    if (!websocket) return;

    const handleWs = async (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);

        // Populate initial room participants
        if (data.type === 'init' && data.state && data.state.active_call_participants) {
          const initList = Object.values(data.state.active_call_participants) as any[];
          setParticipants((prev) => {
            const list: Participant[] = initList.map((item) => ({
              user_id: item.user_id,
              username: item.username,
              is_audio_muted: item.is_audio_muted,
              is_video_off: item.is_video_off,
            }));
            // preserve local user
            const me = prev.find((p) => p.user_id === user.id);
            if (me) {
              return [me, ...list.filter((p) => p.user_id !== user.id)];
            }
            return list;
          });
        }

        // New participant joined call
        if (data.type === 'webrtc_user_joined_call' && data.participant) {
          const p = data.participant;
          setParticipants((prev) => {
            if (prev.some((x) => x.user_id === p.user_id)) return prev;
            return [...prev, { user_id: p.user_id, username: p.username, is_audio_muted: p.is_audio_muted, is_video_off: p.is_video_off }];
          });
        }

        // Participant left call
        if (data.type === 'webrtc_user_left_call' && data.user_id) {
          setParticipants((prev) => prev.filter((p) => p.user_id !== data.user_id));
          const pc = peerConnectionsRef.current.get(data.user_id);
          if (pc) {
            pc.close();
            peerConnectionsRef.current.delete(data.user_id);
          }
        }
      } catch (err) {
        // ignore
      }
    };

    websocket.addEventListener('message', handleWs);
    return () => websocket.removeEventListener('message', handleWs);
  }, [websocket, user.id]);

  return (
    <div className="h-full flex bg-slate-950 text-white overflow-hidden font-sans select-none">
      
      {/* Discord Voice & Video Channels Drawer */}
      <div className="w-64 bg-slate-900/90 border-r border-slate-800 p-4 flex flex-col justify-between shrink-0">
        <div className="space-y-4">
          <div className="flex items-center space-x-2 px-2 text-slate-400">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider">Voice & Video Channels</span>
          </div>

          <div className="space-y-1">
            {voiceChannels.map((ch) => {
              const isActive = activeChannel === ch.id && isInCall;
              return (
                <button
                  key={ch.id}
                  onClick={() => handleJoinCall(ch.id)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    {ch.type === 'video' ? <Video className="w-4 h-4 text-purple-400 shrink-0" /> : <Volume2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                    <span className="truncate">{ch.name}</span>
                  </div>
                  {isActive && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Discord Active Voice Mesh Indicator */}
        <div className="p-3 bg-slate-800/80 rounded-2xl border border-slate-700/60 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center space-x-1.5 text-emerald-400 font-bold text-[11px]">
              <Signal className="w-3.5 h-3.5" />
              <span>{isInCall ? 'Voice Connected' : 'Ready to Connect'}</span>
            </div>
            <span className="text-[10px] text-slate-400">RTC Mesh</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-tight">
            {isInCall ? `Connected to ${activeChannel}` : 'Select a voice channel to join co-workers.'}
          </p>
        </div>
      </div>

      {/* Main Call Stage */}
      <div className="flex-1 flex flex-col bg-slate-950 relative">
        
        {/* Call Stage Top Bar */}
        <div className="px-6 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 z-10 backdrop-blur-sm">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{activeChannel}</h3>
              <p className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {participants.length} Live Member{participants.length !== 1 ? 's' : ''} Connected
              </p>
            </div>
          </div>

          {!isInCall ? (
            <button
              onClick={() => handleJoinCall('General Voice')}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full text-xs font-bold transition-all shadow-lg shadow-emerald-600/30 flex items-center gap-2"
            >
              <Volume2 className="w-4 h-4" />
              <span>Join Voice Channel</span>
            </button>
          ) : (
            <button
              onClick={handleLeaveCall}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-full text-xs font-bold transition-all shadow-lg shadow-rose-600/30 flex items-center gap-2"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Leave Channel</span>
            </button>
          )}
        </div>

        {/* Participant Cards Grid */}
        <div className="flex-1 p-6 overflow-y-auto flex items-center justify-center">
          {participants.length === 0 ? (
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
                <Radio className="w-10 h-10 animate-pulse" />
              </div>
              <h4 className="text-base font-bold text-slate-300">No active members in channel</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Click "Join Voice Channel" or select a room on the left panel to start talking with your team.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 w-full max-w-5xl">
              {participants.map((p) => {
                const isMe = p.user_id === user.id;
                const isSpeaking = p.is_speaking;

                return (
                  <div
                    key={p.user_id}
                    className={`relative bg-slate-900/90 rounded-3xl border ${
                      isSpeaking ? 'border-emerald-400 ring-4 ring-emerald-400/20 shadow-emerald-500/10' : 'border-slate-800'
                    } p-6 flex flex-col items-center justify-center space-y-4 aspect-video shadow-2xl transition-all overflow-hidden group`}
                  >
                    {/* User Avatar with Discord Active Speaker Glow */}
                    <div className="relative">
                      <div
                        className={`w-20 h-20 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 text-white font-black text-2xl flex items-center justify-center shadow-xl transition-all ${
                          isSpeaking ? 'scale-110 border-4 border-emerald-400 shadow-emerald-400/30' : ''
                        }`}
                      >
                        {p.username.charAt(0).toUpperCase()}
                      </div>
                      {p.is_audio_muted && (
                        <div className="absolute -bottom-1 -right-1 bg-rose-600 p-1.5 rounded-full border-2 border-slate-900 text-white shadow-md">
                          <MicOff className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>

                    {/* Username & Status Badge */}
                    <div className="text-center">
                      <div className="flex items-center justify-center space-x-1.5">
                        <span className="text-xs font-bold text-white">@{p.username}</span>
                        {isMe && <span className="text-[10px] text-slate-400 font-semibold">(You)</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {p.is_audio_muted ? 'Muted' : isSpeaking ? 'Speaking...' : 'Connected'}
                      </div>
                    </div>

                    {/* Active Voice Wave Effect */}
                    {isSpeaking && (
                      <div className="absolute top-3 right-3 flex items-center space-x-1">
                        <span className="w-1 h-3 bg-emerald-400 rounded-full animate-bounce" />
                        <span className="w-1 h-5 bg-emerald-400 rounded-full animate-bounce delay-75" />
                        <span className="w-1 h-2 bg-emerald-400 rounded-full animate-bounce delay-150" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Discord Control Bar (Bottom Stage) */}
        {isInCall && (
          <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex items-center justify-center space-x-4 z-20">
            <button
              onClick={toggleAudio}
              className={`p-3.5 rounded-full transition-all shadow-md ${
                isAudioMuted
                  ? 'bg-rose-600 text-white hover:bg-rose-500'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title={isAudioMuted ? 'Unmute Mic' : 'Mute Mic'}
            >
              {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <button
              onClick={toggleDeafen}
              className={`p-3.5 rounded-full transition-all shadow-md ${
                isDeafened
                  ? 'bg-amber-600 text-white hover:bg-amber-500'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white'
              }`}
              title={isDeafened ? 'Undeafen' : 'Deafen'}
            >
              {isDeafened ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>

            <button
              onClick={toggleVideo}
              className={`p-3.5 rounded-full transition-all shadow-md ${
                isVideoOff
                  ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  : 'bg-purple-600 text-white hover:bg-purple-500'
              }`}
              title={isVideoOff ? 'Turn On Camera' : 'Turn Off Camera'}
            >
              {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>

            <button
              onClick={handleLeaveCall}
              className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-full text-xs font-bold transition-all shadow-lg shadow-rose-600/30 flex items-center gap-2"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Disconnect</span>
            </button>
          </div>
        )}

      </div>

    </div>
  );
};
