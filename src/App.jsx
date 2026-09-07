import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { 
  Play, Pause, SkipForward, RotateCcw, Search, 
  Mic, Disc3, QrCode, Smartphone, ListMusic, 
  PartyPopper, Sparkles, X, Check, Wifi, WifiOff, Loader2,
  ChevronUp, ChevronDown, Trash2, Volume2, VolumeX, Volume1,
  Maximize2, Minimize2, SlidersHorizontal, Image as ImageIcon
} from 'lucide-react';

const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || '';

// ดึงรูปปกเพลงจาก YouTube Video ID อัตโนมัติ
const getThumbnail = (ytId, customUrl) => {
  if (customUrl) return customUrl;
  return `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
};

const DEFAULT_PRESETS = [
  { id: 'kJQP7kiw5Fk', ytId: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito (Karaoke Version)', artist: 'Sing King', isKaraoke: true },
  { id: 'fJ9rUzIMcZQ', ytId: 'fJ9rUzIMcZQ', title: 'Queen - Bohemian Rhapsody (Karaoke)', artist: 'KaraokeOnVEVO', isKaraoke: true },
  { id: 'JGwWNGJdvx8', ytId: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', artist: 'Ed Sheeran', isKaraoke: false },
  { id: '450p7goxZqg', ytId: '450p7goxZqg', title: 'John Legend - All of Me (Karaoke Version)', artist: 'Sing King', isKaraoke: true },
];

export default function App() {
  const [currentSong, setCurrentSong] = useState(DEFAULT_PRESETS[0]);
  const [queue, setQueue] = useState(DEFAULT_PRESETS.slice(1));
  const [isPlaying, setIsPlaying] = useState(true);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [isTvFullscreen, setIsTvFullscreen] = useState(false);

  // Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState('karaoke'); // 'karaoke' | 'original'
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Remote & WebRTC States
  const [roomCode, setRoomCode] = useState('');
  const [isRemoteMode, setIsRemoteMode] = useState(false);
  const [mobileTab, setMobileTab] = useState('search'); // 'search' | 'queue' | 'controls'
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 2500);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setIsRemoteMode(true);
      const code = roomParam.trim().toUpperCase();
      setInputRoomCode(code);
      connectToHost(code);
    } else {
      initHost();
    }

    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // -------------------------------------------------------------
  // 1. ฝั่งจอทีวี (Host)
  // -------------------------------------------------------------
  const initHost = () => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }

    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomCode(code);

    const peer = new Peer(`KARAOKE-${code}`);
    peerRef.current = peer;

    peer.on('connection', (conn) => {
      connRef.current = conn;
      setConnectionStatus('connected');
      showToast('📱 มือถือเชื่อมต่อสำเร็จแล้ว!');

      setTimeout(() => {
        conn.send({ 
          type: 'SYNC', 
          queue: queueRef.current, 
          currentSong,
          volume,
          isMuted,
          isTvFullscreen
        });
      }, 500);

      conn.on('data', (data) => {
        switch (data.type) {
          case 'ADD_QUEUE':
            setQueue((prev) => {
              const next = [...prev, data.song];
              conn.send({ type: 'SYNC', queue: next });
              return next;
            });
            showToast(`+ เพิ่มเพลง: ${data.song.title}`);
            break;
          case 'PLAY_NEXT':
            setQueue((prev) => {
              const next = [data.song, ...prev];
              conn.send({ type: 'SYNC', queue: next });
              return next;
            });
            showToast(`⚡ แทรกคิว: ${data.song.title}`);
            break;
          case 'UPDATE_QUEUE':
            setQueue(data.queue);
            conn.send({ type: 'SYNC', queue: data.queue });
            break;
          case 'SKIP':
            handleNextSong();
            break;
          case 'REPLAY':
            if (ytPlayerRef.current?.seekTo) {
              ytPlayerRef.current.seekTo(0);
              ytPlayerRef.current.playVideo();
              setIsPlaying(true);
            }
            break;
          case 'TOGGLE_PLAY':
            if (ytPlayerRef.current) {
              const state = ytPlayerRef.current.getPlayerState();
              if (state === 1) {
                ytPlayerRef.current.pauseVideo();
                setIsPlaying(false);
                conn.send({ type: 'SYNC', isPlaying: false });
              } else {
                ytPlayerRef.current.playVideo();
                setIsPlaying(true);
                conn.send({ type: 'SYNC', isPlaying: true });
              }
            }
            break;
          case 'SET_VOLUME':
            const newVol = Math.max(0, Math.min(100, data.volume));
            setVolume(newVol);
            if (ytPlayerRef.current?.setVolume) {
              ytPlayerRef.current.setVolume(newVol);
              if (newVol > 0 && isMuted) {
                ytPlayerRef.current.unMute();
                setIsMuted(false);
              }
            }
            showToast(`🔊 ระดับเสียง: ${newVol}%`);
            conn.send({ type: 'SYNC', volume: newVol, isMuted: false });
            break;
          case 'TOGGLE_MUTE':
            if (ytPlayerRef.current) {
              if (isMuted) {
                ytPlayerRef.current.unMute();
                setIsMuted(false);
                conn.send({ type: 'SYNC', isMuted: false });
                showToast('🔔 เปิดเสียง');
              } else {
                ytPlayerRef.current.mute();
                setIsMuted(true);
                conn.send({ type: 'SYNC', isMuted: true });
                showToast('🔇 ปิดเสียงชั่วคราว');
              }
            }
            break;
          case 'TOGGLE_FULLSCREEN':
            toggleTvFullscreen();
            break;
          case 'SFX':
            triggerSfx(data.sound);
            break;
          default:
            break;
        }
      });

      conn.on('close', () => setConnectionStatus('disconnected'));
    });
  };

  const toggleTvFullscreen = () => {
    setIsTvFullscreen((prev) => {
      const nextState = !prev;
      if (nextState) {
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      } else {
        if (document.exitFullscreen && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
      }
      if (connRef.current) {
        connRef.current.send({ type: 'SYNC', isTvFullscreen: nextState });
      }
      return nextState;
    });
  };

  // -------------------------------------------------------------
  // 2. ฝั่งมือถือ (Remote Client)
  // -------------------------------------------------------------
  const connectToHost = (targetCode) => {
    if (!targetCode) return;
    setConnectionStatus('connecting');

    if (peerRef.current) peerRef.current.destroy();

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      const conn = peer.connect(`KARAOKE-${targetCode}`, { reliable: true });
      connRef.current = conn;

      conn.on('open', () => {
        setConnectionStatus('connected');
        setShowRemoteModal(false);
      });

      conn.on('data', (data) => {
        if (data.type === 'SYNC') {
          if (data.queue !== undefined) setQueue(data.queue);
          if (data.currentSong !== undefined) setCurrentSong(data.currentSong);
          if (data.volume !== undefined) setVolume(data.volume);
          if (data.isMuted !== undefined) setIsMuted(data.isMuted);
          if (data.isPlaying !== undefined) setIsPlaying(data.isPlaying);
          if (data.isTvFullscreen !== undefined) setIsTvFullscreen(data.isTvFullscreen);
        }
      });

      conn.on('close', () => setConnectionStatus('disconnected'));
      conn.on('error', () => setConnectionStatus('disconnected'));
    });

    peer.on('error', () => setConnectionStatus('disconnected'));
  };

  const sendCommand = (payload) => {
    if (connRef.current && connectionStatus === 'connected') {
      connRef.current.send(payload);
    }
  };

  const moveQueue = (index, direction) => {
    const newQueue = [...queue];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newQueue.length) return;
    
    const temp = newQueue[index];
    newQueue[index] = newQueue[targetIndex];
    newQueue[targetIndex] = temp;

    setQueue(newQueue);
    sendCommand({ type: 'UPDATE_QUEUE', queue: newQueue });
  };

  const removeQueueItem = (index) => {
    const newQueue = queue.filter((_, i) => i !== index);
    setQueue(newQueue);
    sendCommand({ type: 'UPDATE_QUEUE', queue: newQueue });
  };

  // -------------------------------------------------------------
  // เครื่องเล่น YouTube ฝั่งทีวี
  // -------------------------------------------------------------
  useEffect(() => {
    if (isRemoteMode || !currentSong) return;

    const setupPlayer = () => {
      if (!ytPlayerRef.current) {
        ytPlayerRef.current = new window.YT.Player('karaoke-player', {
          videoId: currentSong.ytId,
          playerVars: {
            autoplay: 1,
            controls: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              e.target.setVolume(volume);
              if (isMuted) e.target.mute();
            },
            onStateChange: (e) => {
              if (e.data === window.YT.PlayerState.ENDED) {
                handleNextSong();
              }
            },
          },
        });
      } else if (ytPlayerRef.current.loadVideoById) {
        ytPlayerRef.current.loadVideoById(currentSong.ytId);
      }
    };

    if (window.YT && window.YT.Player) {
      setupPlayer();
    } else {
      window.onYouTubeIframeAPIReady = setupPlayer;
    }
  }, [currentSong, isRemoteMode]);

  const handleNextSong = () => {
    setQueue((prev) => {
      if (prev.length > 0) {
        const next = prev[0];
        const remaining = prev.slice(1);
        setCurrentSong(next);
        if (connRef.current) {
          connRef.current.send({ type: 'SYNC', queue: remaining, currentSong: next });
        }
        return remaining;
      }
      return prev;
    });
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    if (!API_KEY) {
      setSearchError('ยังไม่ได้ใส่ VITE_YOUTUBE_API_KEY ในไฟล์ .env');
      return;
    }

    setIsSearching(true);
    setSearchError('');
    try {
      const query = searchMode === 'karaoke' 
        ? `${searchQuery.trim()} คาราโอเกะ karaoke` 
        : `${searchQuery.trim()} official mv`;

      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(query)}&key=${API_KEY}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const items = (data.items || []).map((item) => ({
        id: item.id.videoId,
        ytId: item.id.videoId,
        title: item.snippet.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
        artist: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        isKaraoke: searchMode === 'karaoke',
      }));
      setSearchResults(items);
    } catch (err) {
      setSearchError('ค้นหาล้มเหลว: ' + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const addSong = (song, playNext = false) => {
    if (isRemoteMode) {
      sendCommand({ type: playNext ? 'PLAY_NEXT' : 'ADD_QUEUE', song });
      showToast(playNext ? '⚡ แทรกคิวบนทีวีแล้ว' : '✔ เพิ่มลงคิวทีวีแล้ว');
    } else {
      if (playNext) {
        setQueue((prev) => [song, ...prev]);
        showToast('⚡ แทรกคิวแล้ว');
      } else {
        setQueue((prev) => [...prev, song]);
        showToast('✔ เพิ่มเพลงลงคิวแล้ว');
      }
    }
  };

  const triggerSfx = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (type === 'applause') {
        const bufferSize = ctx.sampleRate * 1.2;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1000;
        noise.connect(filter);
        filter.connect(ctx.destination);
        noise.start();
      } else if (type === 'cheer') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(450, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (e) {
      console.log(e);
    }
  };

  // =============================================================
  // หน้าจอมือถือ (MOBILE REMOTE VIEW)
  // =============================================================
  if (isRemoteMode) {
    return (
      <div className="max-w-md mx-auto min-h-screen flex flex-col text-slate-100 bg-slate-950 pb-20 select-none">
        {/* Header แถบสถานะ */}
        <div className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md p-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="text-purple-400" size={18} />
            <span className="font-bold text-sm">รีโมทคาราโอเกะ</span>
          </div>

          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-emerald-500/20 text-emerald-400 rounded-full font-bold">
                <Wifi size={12} /> ห้อง: {inputRoomCode}
              </span>
            ) : connectionStatus === 'connecting' ? (
              <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-amber-500/20 text-amber-300 rounded-full font-bold">
                <Loader2 size={12} className="animate-spin" /> กำลังต่อทีวี...
              </span>
            ) : (
              <button
                onClick={() => connectToHost(inputRoomCode)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-rose-500/20 text-rose-300 rounded-full font-bold active:scale-95"
              >
                <WifiOff size={12} /> หลุด (กดต่อใหม่)
              </button>
            )}
          </div>
        </div>

        {/* Toast Alert */}
        {toastMessage && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-purple-600 text-white text-xs font-bold px-4 py-2 rounded-full shadow-xl">
            {toastMessage}
          </div>
        )}

        {/* เนื้อหาแต่ละแท็บ */}
        <div className="flex-1 p-4 overflow-y-auto">
          {/* TAB 1: ค้นหาเพลง */}
          {mobileTab === 'search' && (
            <div className="space-y-4">
              <div className="p-3 bg-slate-900 rounded-2xl border border-slate-800">
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setSearchMode('karaoke')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition ${searchMode === 'karaoke' ? 'bg-purple-600 text-white' : 'text-slate-400 bg-slate-950'}`}
                  >
                    🎤 คาราโอเกะ
                  </button>
                  <button
                    onClick={() => setSearchMode('original')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition ${searchMode === 'original' ? 'bg-purple-600 text-white' : 'text-slate-400 bg-slate-950'}`}
                  >
                    🎵 เพลงปกติ
                  </button>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="พิมพ์ชื่อเพลง หรือศิลปิน..."
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-purple-500"
                  />
                  <button 
                    type="submit" 
                    disabled={isSearching} 
                    className="px-4 bg-purple-600 rounded-xl text-xs font-bold flex items-center gap-1 active:scale-95"
                  >
                    {isSearching ? <Loader2 size={14} className="animate-spin" /> : 'ค้นหา'}
                  </button>
                </form>
                {searchError && <p className="text-[11px] text-rose-400 mt-2">{searchError}</p>}
              </div>

              {/* รายการเพลงพร้อมรูปภาพปก */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  {searchResults.length > 0 ? 'ผลการค้นหา' : 'เพลงแนะนำสำหรับปาร์ตี้'}
                </div>
                {(searchResults.length > 0 ? searchResults : DEFAULT_PRESETS).map((song) => (
                  <div key={song.id} className="flex items-center gap-3 p-2 bg-slate-900 border border-slate-800 rounded-2xl">
                    {/* ภาพปกเพลง / ศิลปิน */}
                    <div className="relative w-16 h-12 rounded-xl overflow-hidden bg-slate-950 shrink-0 border border-slate-800">
                      <img 
                        src={getThumbnail(song.ytId, song.thumbnail)} 
                        alt={song.title} 
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1 right-1 text-[9px] px-1 py-0.2 bg-black/70 rounded text-purple-300 font-bold">
                        {song.isKaraoke ? '🎤' : '🎵'}
                      </span>
                    </div>

                    <div className="truncate flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate text-white">{song.title}</p>
                      <p className="text-[10px] text-slate-400 truncate">{song.artist}</p>
                    </div>

                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => addSong(song, true)} className="px-2.5 py-1.5 bg-pink-600/20 text-pink-300 rounded-lg text-[10px] font-bold active:scale-95">
                        แทรก
                      </button>
                      <button onClick={() => addSong(song, false)} className="px-2.5 py-1.5 bg-purple-600 text-white rounded-lg text-[10px] font-bold active:scale-95">
                        + คิว
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: จัดการคิวเพลง */}
          {mobileTab === 'queue' && (
            <div className="space-y-4">
              {/* เพลงที่กำลังร้องอยู่ พร้อมรูปปก */}
              <div className="p-3 rounded-2xl bg-gradient-to-r from-purple-900/30 to-slate-900 border border-purple-500/30 flex items-center gap-3">
                <div className="w-16 h-12 rounded-xl overflow-hidden bg-black shrink-0 border border-purple-500/40">
                  <img 
                    src={getThumbnail(currentSong?.ytId, currentSong?.thumbnail)} 
                    alt={currentSong?.title} 
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="truncate flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">
                    กำลังร้องอยู่บนทีวี 🎤
                  </span>
                  <p className="text-xs font-bold text-white truncate">{currentSong?.title}</p>
                  <p className="text-[11px] text-slate-400 truncate">{currentSong?.artist}</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-300">
                    รายการคิวถัดไป ({queue.length} เพลง)
                  </span>
                  <span className="text-[10px] text-slate-500">กดลูกศรเพื่อสลับคิว</span>
                </div>

                {queue.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs bg-slate-900/40 rounded-2xl border border-slate-800/50">
                    ไม่มีเพลงในคิว<br />ไปที่แท็บ "ค้นหาเพลง" เพื่อเพิ่มเพลงได้เลย
                  </div>
                ) : (
                  <div className="space-y-2">
                    {queue.map((song, idx) => (
                      <div key={idx} className="flex items-center gap-2.5 p-2 bg-slate-900 border border-slate-800 rounded-2xl">
                        <span className="text-xs font-bold text-purple-400 w-4 text-center shrink-0">{idx + 1}</span>
                        
                        {/* ภาพปกในคิว */}
                        <div className="w-12 h-9 rounded-lg overflow-hidden bg-slate-950 shrink-0 border border-slate-800">
                          <img 
                            src={getThumbnail(song.ytId, song.thumbnail)} 
                            alt="" 
                            className="w-full h-full object-cover"
                          />
                        </div>

                        <div className="truncate flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{song.title}</p>
                          <p className="text-[10px] text-slate-400 truncate">{song.artist}</p>
                        </div>

                        {/* ปุ่มจัดลำดับคิว */}
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            disabled={idx === 0}
                            onClick={() => moveQueue(idx, -1)}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-30 active:scale-90"
                            title="เลื่อนขึ้น"
                          >
                            <ChevronUp size={16} />
                          </button>
                          <button
                            disabled={idx === queue.length - 1}
                            onClick={() => moveQueue(idx, 1)}
                            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 disabled:opacity-30 active:scale-90"
                            title="เลื่อนลง"
                          >
                            <ChevronDown size={16} />
                          </button>
                          <button
                            onClick={() => removeQueueItem(idx)}
                            className="p-1.5 rounded-lg bg-rose-500/20 text-rose-300 active:scale-90 ml-1"
                            title="ลบคิว"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: แผงควบคุม & ทีวี */}
          {mobileTab === 'controls' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">หน้าจอทีวี (Fullscreen)</h4>
                  <p className="text-[11px] text-slate-400">ขยายวิดีโอให้เต็มจอทีวีไร้ขอบ</p>
                </div>
                <button
                  onClick={() => sendCommand({ type: 'TOGGLE_FULLSCREEN' })}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition active:scale-95 ${
                    isTvFullscreen 
                      ? 'bg-purple-600 text-white' 
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {isTvFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  <span>{isTvFullscreen ? 'ย่อจอ' : 'ขยายเต็มจอ'}</span>
                </button>
              </div>

              {/* ปรับเสียง */}
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isMuted || volume === 0 ? (
                      <VolumeX className="text-rose-400" size={18} />
                    ) : volume < 50 ? (
                      <Volume1 className="text-purple-400" size={18} />
                    ) : (
                      <Volume2 className="text-purple-400" size={18} />
                    )}
                    <span className="text-xs font-bold text-white">ระดับเสียงทีวี</span>
                  </div>
                  <span className="text-xs font-bold text-purple-400">
                    {isMuted ? 'ปิดเสียง' : `${volume}%`}
                  </span>
                </div>

                <input
                  type="range"
                  min="0"
                  max="100"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => sendCommand({ type: 'SET_VOLUME', volume: Number(e.target.value) })}
                  className="w-full accent-purple-600 cursor-pointer h-2 bg-slate-950 rounded-lg"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => sendCommand({ type: 'SET_VOLUME', volume: Math.max(0, volume - 10) })}
                    className="flex-1 py-2 rounded-xl bg-slate-800 text-xs font-bold active:scale-95"
                  >
                    - ลดเสียง
                  </button>
                  <button
                    onClick={() => sendCommand({ type: 'TOGGLE_MUTE' })}
                    className={`px-4 py-2 rounded-xl text-xs font-bold active:scale-95 ${isMuted ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-300'}`}
                  >
                    {isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}
                  </button>
                  <button
                    onClick={() => sendCommand({ type: 'SET_VOLUME', volume: Math.min(100, volume + 10) })}
                    className="flex-1 py-2 rounded-xl bg-slate-800 text-xs font-bold active:scale-95"
                  >
                    + เพิ่มเสียง
                  </button>
                </div>
              </div>

              {/* ควบคุมเพลง */}
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800">
                <span className="text-xs font-bold text-white block mb-3">ควบคุมเพลง</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => sendCommand({ type: 'REPLAY' })}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-950 border border-slate-800 active:scale-95"
                  >
                    <RotateCcw size={20} className="text-purple-400 mb-1" />
                    <span className="text-xs font-semibold">ร้องใหม่</span>
                  </button>

                  <button
                    onClick={() => sendCommand({ type: 'TOGGLE_PLAY' })}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-purple-600 text-white active:scale-95"
                  >
                    {isPlaying ? <Pause size={20} className="mb-1" /> : <Play size={20} className="mb-1" />}
                    <span className="text-xs font-semibold">{isPlaying ? 'หยุดชั่วคราว' : 'เล่นต่อ'}</span>
                  </button>

                  <button
                    onClick={() => sendCommand({ type: 'SKIP' })}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-950 border border-slate-800 active:scale-95"
                  >
                    <SkipForward size={20} className="text-purple-400 mb-1" />
                    <span className="text-xs font-semibold">ข้ามเพลง</span>
                  </button>
                </div>
              </div>

              {/* ซาวด์เอฟเฟกต์ */}
              <div className="p-4 bg-slate-900 rounded-2xl border border-slate-800">
                <span className="text-xs font-bold text-white block mb-3">Sound Effects ปาร์ตี้</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => sendCommand({ type: 'SFX', sound: 'applause' })}
                    className="flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-pink-400 font-bold text-xs active:scale-95"
                  >
                    <PartyPopper size={18} /> ปรบมือ 👏
                  </button>
                  <button
                    onClick={() => sendCommand({ type: 'SFX', sound: 'cheer' })}
                    className="flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-amber-400 font-bold text-xs active:scale-95"
                  >
                    <Sparkles size={18} /> หวูดแตร 🎺
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tab Bar */}
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-slate-900/95 backdrop-blur-lg border-t border-slate-800 flex items-center justify-around py-2 px-4 z-40">
          <button
            onClick={() => setMobileTab('search')}
            className={`flex flex-col items-center gap-1 flex-1 py-1 transition ${mobileTab === 'search' ? 'text-purple-400' : 'text-slate-400'}`}
          >
            <Search size={20} />
            <span className="text-[11px] font-bold">ค้นหาเพลง</span>
          </button>

          <button
            onClick={() => setMobileTab('queue')}
            className={`flex flex-col items-center gap-1 flex-1 py-1 relative transition ${mobileTab === 'queue' ? 'text-purple-400' : 'text-slate-400'}`}
          >
            <ListMusic size={20} />
            <span className="text-[11px] font-bold">จัดการคิว</span>
            {queue.length > 0 && (
              <span className="absolute top-0 right-7 w-4 h-4 rounded-full bg-purple-600 text-white text-[10px] font-bold flex items-center justify-center">
                {queue.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setMobileTab('controls')}
            className={`flex flex-col items-center gap-1 flex-1 py-1 transition ${mobileTab === 'controls' ? 'text-purple-400' : 'text-slate-400'}`}
          >
            <SlidersHorizontal size={20} />
            <span className="text-[11px] font-bold">ควบคุม & ทีวี</span>
          </button>
        </div>
      </div>
    );
  }

  // =============================================================
  // หน้าจอหลัก (TV / DESKTOP VIEW)
  // =============================================================
  const remoteUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(remoteUrl)}`;

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-purple-600 text-white text-sm font-bold px-6 py-2.5 rounded-full shadow-2xl">
          {toastMessage}
        </div>
      )}

      {/* Header */}
      {!isTvFullscreen && (
        <header className="flex items-center justify-between px-6 py-3 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-600/20 text-purple-400">
              <Mic size={22} />
            </div>
            <div>
              <h1 className="font-bold text-base leading-tight">Karaoke Station</h1>
              <p className="text-[11px] text-slate-400">ร้องคาราโอเกะออนไลน์</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTvFullscreen}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              title="ขยายเต็มจอ"
            >
              <Maximize2 size={18} />
            </button>

            <button
              onClick={() => setShowRemoteModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 transition shadow-lg"
            >
              <Smartphone size={16} />
              <span>เชื่อมต่อรีโมท</span>
              {connectionStatus === 'connected' && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          </div>
        </header>
      )}

      {/* Main Container */}
      <div className="flex flex-1 flex-col lg:flex-row overflow-hidden relative">
        {/* ซ้าย: เครื่องเล่น YouTube */}
        <div className={`flex flex-col bg-black ${isTvFullscreen ? 'w-full h-full absolute inset-0 z-50' : 'flex-1'}`}>
          <div className="relative flex-1 flex items-center justify-center bg-black">
            <div id="karaoke-player" className="w-full h-full" />
            
            {isTvFullscreen && (
              <button
                onClick={toggleTvFullscreen}
                className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/90 text-white rounded-xl backdrop-blur-md opacity-30 hover:opacity-100 transition"
                title="ย่อจอ"
              >
                <Minimize2 size={20} />
              </button>
            )}
          </div>

          {/* แถบ Now Playing ด้านล่างจอทีวี พร้อมภาพปก */}
          <div className="flex items-center justify-between p-4 bg-slate-900 border-t border-slate-800">
            <div className="flex items-center gap-3 truncate flex-1 pr-4">
              <div className="w-14 h-10 rounded-lg overflow-hidden bg-black shrink-0 border border-purple-500/40">
                <img 
                  src={getThumbnail(currentSong?.ytId, currentSong?.thumbnail)} 
                  alt="" 
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="truncate">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 inline-block mb-0.5">
                  {currentSong?.isKaraoke ? '🎤 คาราโอเกะ' : '🎵 เพลงต้นฉบับ'}
                </span>
                <h2 className="text-sm font-bold text-white truncate">{currentSong?.title}</h2>
                <p className="text-xs text-slate-400 truncate">{currentSong?.artist}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button onClick={() => triggerSfx('applause')} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-95">
                <PartyPopper size={18} />
              </button>
              <button 
                onClick={() => {
                  if (ytPlayerRef.current?.seekTo) {
                    ytPlayerRef.current.seekTo(0);
                    ytPlayerRef.current.playVideo();
                  }
                }} 
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-95"
              >
                <RotateCcw size={18} />
              </button>
              <button onClick={handleNextSong} className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition active:scale-95">
                <SkipForward size={16} /> ข้ามเพลง
              </button>
            </div>
          </div>
        </div>

        {/* ขวา: ค้นหา & คิวเพลงบนทีวี พร้อมรูปปก */}
        {!isTvFullscreen && (
          <div className="w-full lg:w-96 border-l border-slate-800 bg-slate-950 flex flex-col h-72 lg:h-full">
            <div className="p-4 border-b border-slate-800">
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setSearchMode('karaoke')}
                  className={`flex-1 py-1 text-xs font-bold rounded-lg transition ${searchMode === 'karaoke' ? 'bg-purple-600 text-white' : 'bg-slate-900 text-slate-400'}`}
                >
                  🎤 คาราโอเกะ
                </button>
                <button
                  onClick={() => setSearchMode('original')}
                  className={`flex-1 py-1 text-xs font-bold rounded-lg transition ${searchMode === 'original' ? 'bg-purple-600 text-white' : 'bg-slate-900 text-slate-400'}`}
                >
                  🎵 เพลงปกติ
                </button>
              </div>
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาชื่อเพลง หรือศิลปิน..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-purple-500"
                />
                <button type="submit" disabled={isSearching} className="px-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center gap-1">
                  {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                </button>
              </form>
              {searchError && <p className="text-[11px] text-rose-400 mt-2">{searchError}</p>}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {/* ผลการค้นหา */}
              {searchResults.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-purple-400 uppercase tracking-wider">ผลการค้นหา</span>
                    <button onClick={() => setSearchResults([])} className="text-[11px] text-slate-500 hover:text-white">ล้างผล</button>
                  </div>
                  <div className="space-y-1.5">
                    {searchResults.map((song) => (
                      <div key={song.id} className="flex items-center gap-2 p-1.5 rounded-xl bg-slate-900 border border-slate-800">
                        <img 
                          src={getThumbnail(song.ytId, song.thumbnail)} 
                          alt="" 
                          className="w-12 h-9 rounded-lg object-cover bg-black shrink-0" 
                        />
                        <div className="truncate flex-1 min-w-0 pr-1">
                          <p className="text-xs font-semibold text-white truncate">{song.title}</p>
                          <p className="text-[10px] text-slate-400 truncate">{song.artist}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => addSong(song, true)} className="px-2 py-1 bg-pink-600/20 text-pink-300 rounded text-[10px] font-bold">แทรก</button>
                          <button onClick={() => addSong(song, false)} className="px-2 py-1 bg-purple-600 text-white rounded text-[10px] font-bold">+ คิว</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ListMusic size={14} /> คิวเพลง ({queue.length})
                </span>
              </div>

              {queue.map((song, idx) => (
                <div key={idx} className="flex items-center gap-2.5 p-2 rounded-xl bg-slate-900/70 border border-slate-800/80">
                  <span className="text-xs font-bold text-slate-500 w-3 text-center shrink-0">{idx + 1}</span>
                  <img 
                    src={getThumbnail(song.ytId, song.thumbnail)} 
                    alt="" 
                    className="w-10 h-8 rounded-lg object-cover bg-black shrink-0" 
                  />
                  <div className="truncate flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{song.title}</p>
                    <p className="text-[10px] text-slate-400 truncate">{song.artist}</p>
                  </div>
                  <button onClick={() => setQueue((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-500 hover:text-rose-400 p-1 shrink-0">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modal QR Code */}
      {showRemoteModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-6 relative">
            <button onClick={() => setShowRemoteModal(false)} className="absolute top-4 right-4 text-slate-400 hover:text-white">
              <X size={20} />
            </button>

            <div className="text-center mb-4">
              <div className="w-12 h-12 rounded-2xl bg-purple-600/20 text-purple-400 mx-auto flex items-center justify-center mb-3">
                <QrCode size={24} />
              </div>
              <h3 className="font-bold text-lg text-white">ใช้มือถือเป็นรีโมท</h3>
              <p className="text-xs text-slate-400 mt-1">
                สแกน QR Code ด้วยกล้องมือถือ เพื่อเริ่มสั่งงาน
              </p>
            </div>

            <div className="flex flex-col items-center justify-center p-4 bg-slate-950 rounded-2xl border border-slate-800 mb-4">
              <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48 rounded-xl p-2 bg-white" />
              <div className="text-center mt-3">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">รหัสห้อง:</span>
                <div className="text-3xl font-black text-purple-400 tracking-widest mt-0.5">{roomCode}</div>
              </div>
            </div>

            <div className="text-center text-xs text-slate-400">
              สถานะ: {connectionStatus === 'connected' ? <span className="text-emerald-400 font-bold">● มือถือเชื่อมต่อแล้ว</span> : <span className="text-amber-400">○ รอการสแกน...</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}