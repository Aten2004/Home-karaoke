import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer from 'peerjs';
import { 
  Play, Pause, SkipForward, RotateCcw, Search, 
  QrCode, Smartphone, ListMusic, X, Check, Wifi, WifiOff, Loader2,
  Trash2, Volume2, VolumeX, Volume1, Maximize2, Minimize2, 
  SlidersHorizontal, Link as LinkIcon, Tv, GripVertical, ArrowLeft
} from 'lucide-react';

const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY || '';

const getThumbnail = (ytId, customUrl) => {
  if (customUrl) return customUrl;
  return `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
};

const extractYtId = (url) => {
  if (!url) return null;
  const cleanUrl = url.trim();
  const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|youtube\.com\/shorts\/)([^"&?\/\s]{11})/;
  const match = cleanUrl.match(regExp);
  if (match && match[1]) return match[1];
  if (cleanUrl.length === 11 && !cleanUrl.includes(' ') && !cleanUrl.includes('/')) return cleanUrl;
  return null;
};

export default function App() {
  // Navigation: 'home' | 'tv' | 'remote'
  const [viewMode, setViewMode] = useState('home');

  // Player States (เริ่มต้นว่างเปล่า)
  const [currentSong, setCurrentSong] = useState(null);
  const [queue, setQueue] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [isMuted, setIsMuted] = useState(false);
  const [isTvFullscreen, setIsTvFullscreen] = useState(false);

  // Search & URL States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState('karaoke');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [directUrl, setDirectUrl] = useState('');

  // Remote & WebRTC States
  const [roomCode, setRoomCode] = useState('');
  const [mobileTab, setMobileTab] = useState('search');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Drag & Drop State สำหรับจัดลำดับคิว
  const [draggedIndex, setDraggedIndex] = useState(null);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const currentSongRef = useRef(currentSong);
  currentSongRef.current = currentSong;
  const activeRoomCodeRef = useRef('');

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 2500);
  };

  // ตรวจสอบ URL เมื่อเปิดเว็บ
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    
    if (roomParam) {
      const code = roomParam.trim().toUpperCase();
      setViewMode('remote');
      setInputRoomCode(code);
      activeRoomCodeRef.current = code;
      localStorage.setItem('karaoke_saved_room', code);
      connectToHost(code);
    }

    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // -------------------------------------------------------------
  // 1. ฝั่งจอทีวี (TV Host)
  // -------------------------------------------------------------
  const initHost = () => {
    setViewMode('tv');

    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.body.appendChild(tag);
    }

    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    setRoomCode(code);

    if (peerRef.current) peerRef.current.destroy();

    const peer = new Peer(`KARAOKE-${code}`);
    peerRef.current = peer;

    peer.on('disconnected', () => {
      if (peer && !peer.destroyed) peer.reconnect();
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
      setConnectionStatus('connected');
      showToast('📱 รีโมทมือถือเชื่อมต่อแล้ว');

      setTimeout(() => {
        conn.send({ 
          type: 'SYNC', 
          queue: queueRef.current, 
          currentSong: currentSongRef.current,
          volume,
          isMuted,
          isTvFullscreen
        });
      }, 500);

      conn.on('data', (data) => {
        switch (data.type) {
          case 'ADD_QUEUE':
            if (!currentSongRef.current) {
              setCurrentSong(data.song);
              conn.send({ type: 'SYNC', currentSong: data.song });
              showToast(`▶ กำลังเล่น: ${data.song.title}`);
            } else {
              setQueue((prev) => {
                const next = [...prev, data.song];
                conn.send({ type: 'SYNC', queue: next });
                return next;
              });
              showToast(`+ เพิ่มเพลง: ${data.song.title}`);
            }
            break;
          case 'PLAY_NEXT':
            if (!currentSongRef.current) {
              setCurrentSong(data.song);
              conn.send({ type: 'SYNC', currentSong: data.song });
            } else {
              setQueue((prev) => {
                const next = [data.song, ...prev];
                conn.send({ type: 'SYNC', queue: next });
                return next;
              });
              showToast(`⚡ แทรกคิว: ${data.song.title}`);
            }
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
            if (ytPlayerRef.current) {
              ytPlayerRef.current.setVolume(newVol);
              if (newVol > 0) {
                ytPlayerRef.current.unMute();
                setIsMuted(false);
              } else {
                ytPlayerRef.current.mute();
                setIsMuted(true);
              }
            }
            showToast(`🔊 เสียง: ${newVol}%`);
            conn.send({ type: 'SYNC', volume: newVol, isMuted: newVol === 0 });
            break;
          case 'TOGGLE_MUTE':
            if (ytPlayerRef.current) {
              if (isMuted) {
                const targetVol = volume > 0 ? volume : 80;
                ytPlayerRef.current.unMute();
                ytPlayerRef.current.setVolume(targetVol);
                setVolume(targetVol);
                setIsMuted(false);
                conn.send({ type: 'SYNC', isMuted: false, volume: targetVol });
                showToast(`🔔 เปิดเสียง (${targetVol}%)`);
              } else {
                ytPlayerRef.current.mute();
                setIsMuted(true);
                conn.send({ type: 'SYNC', isMuted: true });
                showToast('🔇 ปิดเสียง');
              }
            }
            break;
          case 'TOGGLE_FULLSCREEN':
            toggleTvFullscreen();
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
  const connectToHost = useCallback((targetCode) => {
    if (!targetCode) return;
    activeRoomCodeRef.current = targetCode;
    setConnectionStatus('connecting');

    if (connRef.current) {
      try { connRef.current.close(); } catch (_) {}
    }
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (_) {}
    }

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

    peer.on('disconnected', () => {
      if (peer && !peer.destroyed) peer.reconnect();
    });

    peer.on('error', () => {
      setConnectionStatus('disconnected');
    });
  }, []);

  // ดักจับการสลับแอป (Auto-Reconnect)
  useEffect(() => {
    if (viewMode !== 'remote') return;

    const handleReturnToTab = () => {
      if (document.visibilityState === 'visible') {
        const target = activeRoomCodeRef.current || localStorage.getItem('karaoke_saved_room');
        if (target && (!connRef.current || !connRef.current.open || connectionStatus !== 'connected')) {
          connectToHost(target);
        }
      }
    };

    document.addEventListener('visibilitychange', handleReturnToTab);
    window.addEventListener('focus', handleReturnToTab);

    return () => {
      document.removeEventListener('visibilitychange', handleReturnToTab);
      window.removeEventListener('focus', handleReturnToTab);
    };
  }, [viewMode, connectionStatus, connectToHost]);

  const sendCommand = (payload) => {
    if (connRef.current && connectionStatus === 'connected') {
      connRef.current.send(payload);
    } else {
      showToast('⚠️ กำลังเชื่อมต่อทีวีใหม่...');
      const target = activeRoomCodeRef.current || localStorage.getItem('karaoke_saved_room');
      if (target) connectToHost(target);
    }
  };

  // Drag & Drop เพื่อสลับตำแหน่งคิว
  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newQueue = [...queue];
    const draggedItem = newQueue[draggedIndex];
    newQueue.splice(draggedIndex, 1);
    newQueue.splice(index, 0, draggedItem);

    setDraggedIndex(index);
    setQueue(newQueue);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    if (viewMode === 'remote') {
      sendCommand({ type: 'UPDATE_QUEUE', queue });
    }
  };

  const removeQueueItem = (index) => {
    const newQueue = queue.filter((_, i) => i !== index);
    setQueue(newQueue);
    if (viewMode === 'remote') {
      sendCommand({ type: 'UPDATE_QUEUE', queue: newQueue });
    }
  };

  // -------------------------------------------------------------
  // เครื่องเล่น YouTube ฝั่งทีวี
  // -------------------------------------------------------------
  useEffect(() => {
    if (viewMode !== 'tv' || !currentSong) return;

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
              if (isMuted) {
                e.target.mute();
              } else {
                e.target.unMute();
                e.target.setVolume(volume);
              }
              setIsPlaying(true);
            },
            onStateChange: (e) => {
              if (e.data === window.YT.PlayerState.PLAYING) {
                setIsPlaying(true);
                if (!isMuted && e.target.unMute) {
                  e.target.unMute();
                  e.target.setVolume(volume);
                }
              } else if (e.data === window.YT.PlayerState.PAUSED) {
                setIsPlaying(false);
              } else if (e.data === window.YT.PlayerState.ENDED) {
                handleNextSong();
              }
            },
          },
        });
      } else if (ytPlayerRef.current.loadVideoById) {
        ytPlayerRef.current.loadVideoById(currentSong.ytId);
        setIsPlaying(true);
        setTimeout(() => {
          if (ytPlayerRef.current) {
            if (isMuted) {
              ytPlayerRef.current.mute();
            } else {
              ytPlayerRef.current.unMute();
              ytPlayerRef.current.setVolume(volume);
            }
          }
        }, 300);
      }
    };

    if (window.YT && window.YT.Player) {
      setupPlayer();
    } else {
      window.onYouTubeIframeAPIReady = setupPlayer;
    }
  }, [currentSong, viewMode]);

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
      } else {
        setCurrentSong(null);
        if (connRef.current) {
          connRef.current.send({ type: 'SYNC', queue: [], currentSong: null });
        }
        return [];
      }
    });
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    if (!API_KEY) {
      setSearchError('ยังไม่ได้ระบุ VITE_YOUTUBE_API_KEY ในระบบ');
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

  const handleAddDirectUrl = (playNext = false) => {
    const videoId = extractYtId(directUrl);
    if (!videoId) {
      alert('กรุณาระบุลิงก์ YouTube ที่ถูกต้อง');
      return;
    }

    const newSong = {
      id: `${videoId}-${Date.now()}`,
      ytId: videoId,
      title: `YouTube Video (${videoId})`,
      artist: 'ลิงก์ตรง (Direct URL)',
      thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      isKaraoke: searchMode === 'karaoke',
    };

    addSong(newSong, playNext);
    setDirectUrl('');
    setShowUrlInput(false);
    showToast(playNext ? '⚡ แทรกเพลงจากลิงก์แล้ว' : '✔ เพิ่มเพลงจากลิงก์ในคิวแล้ว');
  };

  const addSong = (song, playNext = false) => {
    if (viewMode === 'remote') {
      sendCommand({ type: playNext ? 'PLAY_NEXT' : 'ADD_QUEUE', song });
      showToast(playNext ? '⚡ แทรกคิวบนทีวีแล้ว' : '✔ เพิ่มลงคิวทีวีแล้ว');
    } else {
      if (!currentSong) {
        setCurrentSong(song);
        showToast(`▶ กำลังเล่น: ${song.title}`);
      } else if (playNext) {
        setQueue((prev) => [song, ...prev]);
        showToast('⚡ แทรกคิวแล้ว');
      } else {
        setQueue((prev) => [...prev, song]);
        showToast('✔ เพิ่มเพลงลงคิวแล้ว');
      }
    }
  };

  // =============================================================
  // 1. หน้า HOME (สำหรับเลือกโหมดใช้งาน)
  // =============================================================
  if (viewMode === 'home') {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6 select-none relative overflow-hidden">
        {/* Background glow subtle */}
        <div className="absolute w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -top-20 -left-20 pointer-events-none" />
        <div className="absolute w-96 h-96 bg-sky-500/10 rounded-full blur-3xl -bottom-20 -right-20 pointer-events-none" />

        <div className="max-w-md w-full text-center space-y-8 relative z-10">
          {/* Logo & Brand */}
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-3xl shadow-2xl">
              <img src="/logo.png" alt="Karaoke Logo" className="w-16 h-16 object-contain" />
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-white">K-STATION</h1>
              <p className="text-xs text-zinc-400 mt-1">Smart Karaoke System</p>
            </div>
          </div>

          {/* Selection Cards */}
          <div className="space-y-4">
            {/* ตัวเลือกที่ 1: หน้าจอทีวี */}
            <button
              onClick={initHost}
              className="w-full p-5 bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-800 hover:border-cyan-500/50 rounded-2xl text-left transition flex items-center gap-4 group shadow-lg active:scale-[0.99]"
            >
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0 group-hover:bg-cyan-500 group-hover:text-zinc-950 transition">
                <Tv size={24} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                  เปิดเครื่องเล่นบนจอทีวี (TV Player)
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  สำหรับเปิดบนจอ Smart TV หรือคอมพิวเตอร์ เพื่อแสดงวิดีโอคาราโอเกะ
                </p>
              </div>
            </button>

            {/* ตัวเลือกที่ 2: รีโมทมือถือ */}
            <div className="p-5 bg-zinc-900/90 border border-zinc-800 rounded-2xl text-left space-y-3 shadow-lg">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                  <Smartphone size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">ใช้งานเป็นรีโมท (Remote)</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    สแกน QR Code จากหน้าจอทีวี หรือใส่รหัสห้อง 4 หลักด้านล่าง
                  </p>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <input
                  type="text"
                  maxLength={4}
                  value={inputRoomCode}
                  onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())}
                  placeholder="รหัสห้อง เช่น AB12"
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-center font-bold tracking-widest text-cyan-400 focus:outline-none focus:border-cyan-500 uppercase placeholder:text-zinc-600"
                />
                <button
                  disabled={!inputRoomCode.trim()}
                  onClick={() => {
                    setViewMode('remote');
                    connectToHost(inputRoomCode.trim());
                  }}
                  className="px-5 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold rounded-xl text-xs transition disabled:opacity-40 disabled:hover:bg-cyan-500 active:scale-95"
                >
                  เชื่อมต่อ
                </button>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-zinc-600">
            ระบบ Serverless เชื่อมต่อแบบ Peer-to-Peer ใช้งานได้ฟรี ไม่จำกัดชั่วโมง
          </div>
        </div>
      </div>
    );
  }

  // =============================================================
  // 2. หน้าจอมือถือ (MOBILE REMOTE VIEW)
  // =============================================================
  if (viewMode === 'remote') {
    return (
      <div className="max-w-md mx-auto min-h-screen flex flex-col text-zinc-100 bg-zinc-950 pb-20 select-none">
        {/* Header แถบสถานะ */}
        <div className="sticky top-0 z-40 bg-zinc-950/95 backdrop-blur-md p-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="Logo" className="w-5 h-5 object-contain" />
            <span className="font-bold text-xs text-zinc-200">K-STATION REMOTE</span>
          </div>

          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <span className="flex items-center gap-1 text-[11px] px-2.5 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full font-bold">
                <Wifi size={12} /> ห้อง: {inputRoomCode}
              </span>
            ) : connectionStatus === 'connecting' ? (
              <span className="flex items-center gap-1 text-[11px] px-2.5 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full font-bold">
                <Loader2 size={12} className="animate-spin" /> กำลังเชื่อมต่อ...
              </span>
            ) : (
              <button
                onClick={() => connectToHost(inputRoomCode || localStorage.getItem('karaoke_saved_room'))}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full font-bold active:scale-95"
              >
                <WifiOff size={12} /> หลุด (กดต่อใหม่)
              </button>
            )}
          </div>
        </div>

        {/* Toast Alert */}
        {toastMessage && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-cyan-500 text-zinc-950 text-xs font-bold px-4 py-2 rounded-full shadow-xl">
            {toastMessage}
          </div>
        )}

        {/* เนื้อหาแต่ละแท็บบนมือถือ */}
        <div className="flex-1 p-4 overflow-y-auto">
          {/* TAB 1: ค้นหาเพลง */}
          {mobileTab === 'search' && (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-900 rounded-2xl border border-zinc-800">
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setSearchMode('karaoke')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition ${searchMode === 'karaoke' ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 bg-zinc-950'}`}
                  >
                    🎤 คาราโอเกะ
                  </button>
                  <button
                    onClick={() => setSearchMode('original')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-xl transition ${searchMode === 'original' ? 'bg-cyan-500 text-zinc-950' : 'text-zinc-400 bg-zinc-950'}`}
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
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-cyan-500 text-white"
                  />
                  <button 
                    type="submit" 
                    disabled={isSearching} 
                    className="px-4 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 rounded-xl text-xs font-bold flex items-center gap-1 active:scale-95"
                  >
                    {isSearching ? <Loader2 size={14} className="animate-spin" /> : 'ค้นหา'}
                  </button>
                </form>

                {/* วางลิงก์ YouTube โดยตรง */}
                <div className="mt-2 pt-2 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowUrlInput(!showUrlInput)}
                    className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition active:scale-95"
                  >
                    <LinkIcon size={13} />
                    <span>{showUrlInput ? '▲ ซ่อนช่องใส่ลิงก์' : '🔗 วางลิงก์ YouTube (ไม่เสียโควต้า)'}</span>
                  </button>

                  {showUrlInput && (
                    <div className="mt-2 p-2.5 bg-zinc-950 rounded-xl border border-cyan-500/30 space-y-2">
                      <input
                        type="text"
                        value={directUrl}
                        onChange={(e) => setDirectUrl(e.target.value)}
                        placeholder="วางลิงก์ YouTube ที่นี่..."
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-cyan-500 text-white"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleAddDirectUrl(true)}
                          className="px-2.5 py-1 bg-zinc-800 text-zinc-300 hover:text-white rounded-lg text-[10px] font-bold active:scale-95"
                        >
                          แทรกคิว
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAddDirectUrl(false)}
                          className="px-2.5 py-1 bg-cyan-500 text-zinc-950 rounded-lg text-[10px] font-bold active:scale-95"
                        >
                          + เพิ่มในคิว
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {searchError && <p className="text-[11px] text-rose-400 mt-2">{searchError}</p>}
              </div>

              {/* แสดงผลการค้นหา */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                  {searchResults.length > 0 ? 'ผลการค้นหา' : 'ค้นหาเพลงที่ต้องการร้อง'}
                </div>
                {searchResults.length === 0 && (
                  <div className="text-center py-12 text-zinc-600 text-xs bg-zinc-900/30 rounded-2xl border border-zinc-800/40">
                    พิมพ์ชื่อเพลงหรือวางลิงก์ YouTube ด้านบนเพื่อเพิ่มเพลง
                  </div>
                )}
                {searchResults.map((song) => (
                  <div key={song.id} className="flex items-center gap-3 p-2 bg-zinc-900 border border-zinc-800 rounded-2xl">
                    <div className="relative w-16 h-12 rounded-xl overflow-hidden bg-zinc-950 shrink-0 border border-zinc-800">
                      <img 
                        src={getThumbnail(song.ytId, song.thumbnail)} 
                        alt={song.title} 
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute bottom-1 right-1 text-[9px] px-1 py-0.2 bg-black/80 rounded text-cyan-300 font-bold">
                        {song.isKaraoke ? '🎤' : '🎵'}
                      </span>
                    </div>

                    <div className="truncate flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate text-white">{song.title}</p>
                      <p className="text-[10px] text-zinc-400 truncate">{song.artist}</p>
                    </div>

                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => addSong(song, true)} className="px-2.5 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-[10px] font-bold active:scale-95">
                        แทรก
                      </button>
                      <button onClick={() => addSong(song, false)} className="px-2.5 py-1.5 bg-cyan-500 text-zinc-950 rounded-lg text-[10px] font-bold active:scale-95">
                        + คิว
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: จัดการคิวเพลง (ระบบกดค้างแล้วลาก) */}
          {mobileTab === 'queue' && (
            <div className="space-y-4">
              {/* เพลงที่กำลังเล่นอยู่ */}
              <div className="p-3 rounded-2xl bg-zinc-900 border border-cyan-500/30 flex items-center gap-3">
                <div className="w-16 h-12 rounded-xl overflow-hidden bg-black shrink-0 border border-cyan-500/40">
                  {currentSong ? (
                    <img 
                      src={getThumbnail(currentSong.ytId, currentSong.thumbnail)} 
                      alt="" 
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">ว่าง</div>
                  )}
                </div>
                <div className="truncate flex-1 min-w-0">
                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider block">
                    {currentSong ? 'กำลังเล่นอยู่บนทีวี 🎤' : 'ยังไม่มีเพลงกำลังเล่น'}
                  </span>
                  <p className="text-xs font-bold text-white truncate">
                    {currentSong ? currentSong.title : 'เลือกเพลงเพื่อเริ่มร้อง'}
                  </p>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {currentSong ? currentSong.artist : '-'}
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-zinc-300">
                    รายการคิวถัดไป ({queue.length} เพลง)
                  </span>
                  <span className="text-[10px] text-zinc-500">กดค้างที่ไอคอน ⠿ เพื่อลากสลับคิว</span>
                </div>

                {queue.length === 0 ? (
                  <div className="text-center py-12 text-zinc-600 text-xs bg-zinc-900/40 rounded-2xl border border-zinc-800/50">
                    ไม่มีเพลงในคิว<br />ไปที่แท็บ "ค้นหาเพลง" เพื่อเพิ่มเพลงได้เลย
                  </div>
                ) : (
                  <div className="space-y-2">
                    {queue.map((song, idx) => (
                      <div 
                        key={`${song.id}-${idx}`}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-2.5 p-2 bg-zinc-900 border rounded-2xl transition ${
                          draggedIndex === idx 
                            ? 'border-cyan-500 bg-zinc-800/80 opacity-60 scale-[0.98]' 
                            : 'border-zinc-800'
                        }`}
                      >
                        {/* ไอคอนกริปลาก */}
                        <div className="cursor-grab active:cursor-grabbing text-zinc-500 hover:text-cyan-400 p-1 shrink-0 touch-none">
                          <GripVertical size={16} />
                        </div>

                        <span className="text-xs font-bold text-cyan-400 w-3 text-center shrink-0">{idx + 1}</span>
                        
                        <div className="w-12 h-9 rounded-lg overflow-hidden bg-zinc-950 shrink-0 border border-zinc-800">
                          <img 
                            src={getThumbnail(song.ytId, song.thumbnail)} 
                            alt="" 
                            className="w-full h-full object-cover"
                          />
                        </div>

                        <div className="truncate flex-1 min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{song.title}</p>
                          <p className="text-[10px] text-zinc-400 truncate">{song.artist}</p>
                        </div>

                        <button
                          onClick={() => removeQueueItem(idx)}
                          className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-400 active:scale-90 shrink-0"
                          title="ลบคิว"
                        >
                          <Trash2 size={16} />
                        </button>
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
              {/* สลับเต็มจอทีวี */}
              <div className="p-4 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-white">หน้าจอทีวี (Fullscreen)</h4>
                  <p className="text-[11px] text-zinc-400">ขยายวิดีโอเต็มจอทีวีแบบไร้ขอบ</p>
                </div>
                <button
                  onClick={() => sendCommand({ type: 'TOGGLE_FULLSCREEN' })}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition active:scale-95 ${
                    isTvFullscreen 
                      ? 'bg-cyan-500 text-zinc-950' 
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {isTvFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  <span>{isTvFullscreen ? 'ย่อจอ' : 'ขยายเต็มจอ'}</span>
                </button>
              </div>

              {/* ปรับเสียง */}
              <div className="p-4 bg-zinc-900 rounded-2xl border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isMuted || volume === 0 ? (
                      <VolumeX className="text-rose-400" size={18} />
                    ) : volume < 50 ? (
                      <Volume1 className="text-cyan-400" size={18} />
                    ) : (
                      <Volume2 className="text-cyan-400" size={18} />
                    )}
                    <span className="text-xs font-bold text-white">ระดับเสียงทีวี</span>
                  </div>
                  <span className="text-xs font-bold text-cyan-400">
                    {isMuted ? 'ปิดเสียง' : `${volume}%`}
                  </span>
                </div>

                <input
                  type="range"
                  min="0"
                  max="100"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => sendCommand({ type: 'SET_VOLUME', volume: Number(e.target.value) })}
                  className="w-full accent-cyan-500 cursor-pointer h-2 bg-zinc-950 rounded-lg"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => sendCommand({ type: 'SET_VOLUME', volume: Math.max(0, volume - 10) })}
                    className="flex-1 py-2 rounded-xl bg-zinc-800 text-xs font-bold active:scale-95 text-zinc-300"
                  >
                    - ลดเสียง
                  </button>
                  <button
                    onClick={() => sendCommand({ type: 'TOGGLE_MUTE' })}
                    className={`px-4 py-2 rounded-xl text-xs font-bold active:scale-95 transition ${
                      isMuted ? 'bg-rose-600 text-white' : 'bg-zinc-800 text-zinc-300'
                    }`}
                  >
                    {isMuted ? 'เปิดเสียง' : 'ปิดเสียง'}
                  </button>
                  <button
                    onClick={() => sendCommand({ type: 'SET_VOLUME', volume: Math.min(100, volume + 10) })}
                    className="flex-1 py-2 rounded-xl bg-zinc-800 text-xs font-bold active:scale-95 text-zinc-300"
                  >
                    + เพิ่มเสียง
                  </button>
                </div>
              </div>

              {/* ควบคุมเพลง */}
              <div className="p-4 bg-zinc-900 rounded-2xl border border-zinc-800">
                <span className="text-xs font-bold text-white block mb-3">ควบคุมเพลง</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => sendCommand({ type: 'REPLAY' })}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-zinc-950 border border-zinc-800 active:scale-95"
                  >
                    <RotateCcw size={20} className="text-cyan-400 mb-1" />
                    <span className="text-xs font-semibold">ร้องใหม่</span>
                  </button>

                  <button
                    onClick={() => sendCommand({ type: 'TOGGLE_PLAY' })}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-cyan-500 text-zinc-950 active:scale-95 font-bold"
                  >
                    {isPlaying ? <Pause size={20} className="mb-1" /> : <Play size={20} className="mb-1" />}
                    <span className="text-xs">{isPlaying ? 'หยุด' : 'เล่นต่อ'}</span>
                  </button>

                  <button
                    onClick={() => sendCommand({ type: 'SKIP' })}
                    className="flex flex-col items-center justify-center p-3 rounded-xl bg-zinc-950 border border-zinc-800 active:scale-95"
                  >
                    <SkipForward size={20} className="text-cyan-400 mb-1" />
                    <span className="text-xs font-semibold">ข้ามเพลง</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Tab Bar ล่าง */}
        <div className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-zinc-950/95 backdrop-blur-lg border-t border-zinc-800 flex items-center justify-around py-2 px-4 z-40">
          <button
            onClick={() => setMobileTab('search')}
            className={`flex flex-col items-center gap-1 flex-1 py-1 transition ${mobileTab === 'search' ? 'text-cyan-400 font-bold' : 'text-zinc-500'}`}
          >
            <Search size={18} />
            <span className="text-[11px]">ค้นหาเพลง</span>
          </button>

          <button
            onClick={() => setMobileTab('queue')}
            className={`flex flex-col items-center gap-1 flex-1 py-1 relative transition ${mobileTab === 'queue' ? 'text-cyan-400 font-bold' : 'text-zinc-500'}`}
          >
            <ListMusic size={18} />
            <span className="text-[11px]">จัดการคิว</span>
            {queue.length > 0 && (
              <span className="absolute top-0 right-7 w-4 h-4 rounded-full bg-cyan-500 text-zinc-950 text-[10px] font-bold flex items-center justify-center">
                {queue.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setMobileTab('controls')}
            className={`flex flex-col items-center gap-1 flex-1 py-1 transition ${mobileTab === 'controls' ? 'text-cyan-400 font-bold' : 'text-zinc-500'}`}
          >
            <SlidersHorizontal size={18} />
            <span className="text-[11px]">ควบคุม & ทีวี</span>
          </button>
        </div>
      </div>
    );
  }

  // =============================================================
  // 3. หน้าจอหลัก (TV / DESKTOP VIEW)
  // =============================================================
  const remoteUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(remoteUrl)}`;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden select-none">
      {/* Toast Alert ลอยบนทีวี */}
      {toastMessage && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-cyan-500 text-zinc-950 text-sm font-bold px-6 py-2.5 rounded-full shadow-2xl">
          {toastMessage}
        </div>
      )}

      {/* Header บนทีวี */}
      {!isTvFullscreen && (
        <header className="flex items-center justify-between px-6 py-3 bg-zinc-900 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setViewMode('home')}
              className="p-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition"
              title="กลับหน้าหลัก"
            >
              <ArrowLeft size={16} />
            </button>
            <img src="/logo.png" alt="Karaoke Logo" className="w-8 h-8 object-contain" />
            <div>
              <h1 className="font-bold text-sm tracking-wide text-white">K-STATION</h1>
              <p className="text-[10px] text-zinc-400">ระบบจอคาราโอเกะหลัก</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleTvFullscreen}
              className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
              title="ขยายเต็มจอ"
            >
              <Maximize2 size={16} />
            </button>

            <button
              onClick={() => setShowRemoteModal(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white transition shadow-sm"
            >
              <Smartphone size={15} className="text-cyan-400" />
              <span>รหัสห้อง: <strong className="text-cyan-400 tracking-wider">{roomCode}</strong></span>
              {connectionStatus === 'connected' ? (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-zinc-600" />
              )}
            </button>
          </div>
        </header>
      )}

      {/* Main Container */}
      <div className="flex flex-1 flex-col lg:flex-row overflow-hidden relative">
        {/* ซ้าย: เครื่องเล่น YouTube หรือ หน้ารอสแตนด์บาย */}
        <div className={`flex flex-col bg-black ${isTvFullscreen ? 'w-full h-full absolute inset-0 z-50' : 'flex-1'}`}>
          <div className="relative flex-1 flex items-center justify-center bg-black">
            {currentSong ? (
              <div id="karaoke-player" className="w-full h-full" />
            ) : (
              /* Standby Screen เมื่อยังไม่มีการเปิดเพลง */
              <div className="flex flex-col items-center justify-center p-8 text-center space-y-5 max-w-md">
                <img src="/logo.svg" alt="Logo" className="w-24 h-24 object-contain opacity-80" />
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-white tracking-wide">พร้อมเริ่มร้องคาราโอเกะ</h2>
                  <p className="text-xs text-zinc-400">
                    สแกน QR Code เพื่อใช้มือถือเป็นรีโมท หรือเลือกเพลงจากแถบด้านขวา
                  </p>
                </div>
                <div className="p-3 bg-white rounded-2xl shadow-xl">
                  <img src={qrCodeUrl} alt="Remote QR" className="w-36 h-36" />
                </div>
                <div className="text-xs text-zinc-400">
                  รหัสห้องรีโมท: <span className="font-bold text-cyan-400 tracking-widest text-sm">{roomCode}</span>
                </div>
              </div>
            )}
            
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

          {/* แถบ Now Playing ด้านล่างจอทีวี */}
          <div className="flex items-center justify-between p-3.5 bg-zinc-900 border-t border-zinc-800">
            <div className="flex items-center gap-3 truncate flex-1 pr-4">
              <div className="w-14 h-10 rounded-lg overflow-hidden bg-black shrink-0 border border-zinc-800">
                {currentSong ? (
                  <img 
                    src={getThumbnail(currentSong.ytId, currentSong.thumbnail)} 
                    alt="" 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">ว่าง</div>
                )}
              </div>

              <div className="truncate">
                <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-zinc-800 text-cyan-300 inline-block mb-0.5">
                  {currentSong ? (currentSong.isKaraoke ? '🎤 คาราโอเกะ' : '🎵 เพลงปกติ') : 'พร้อมใช้งาน'}
                </span>
                <h2 className="text-xs font-bold text-white truncate">
                  {currentSong ? currentSong.title : 'รอเพลงจากรีโมทหรือคิวเพลง...'}
                </h2>
                <p className="text-[11px] text-zinc-400 truncate">
                  {currentSong ? currentSong.artist : '-'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  if (ytPlayerRef.current?.seekTo) {
                    ytPlayerRef.current.seekTo(0);
                    ytPlayerRef.current.playVideo();
                  }
                }} 
                className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 active:scale-95"
                title="ร้องใหม่"
              >
                <RotateCcw size={16} />
              </button>
              <button 
                onClick={handleNextSong} 
                className="flex items-center gap-1.5 px-3.5 py-2 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 rounded-xl text-xs font-bold transition active:scale-95"
              >
                <SkipForward size={15} /> ข้ามเพลง
              </button>
            </div>
          </div>
        </div>

        {/* ขวา: ค้นหา & คิวเพลงบนทีวี */}
        {!isTvFullscreen && (
          <div className="w-full lg:w-96 border-l border-zinc-800 bg-zinc-950 flex flex-col h-72 lg:h-full">
            <div className="p-4 border-b border-zinc-800">
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setSearchMode('karaoke')}
                  className={`flex-1 py-1 text-xs font-bold rounded-lg transition ${searchMode === 'karaoke' ? 'bg-cyan-500 text-zinc-950' : 'bg-zinc-900 text-zinc-400'}`}
                >
                  🎤 คาราโอเกะ
                </button>
                <button
                  onClick={() => setSearchMode('original')}
                  className={`flex-1 py-1 text-xs font-bold rounded-lg transition ${searchMode === 'original' ? 'bg-cyan-500 text-zinc-950' : 'bg-zinc-900 text-zinc-400'}`}
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
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-cyan-500 text-white"
                />
                <button type="submit" disabled={isSearching} className="px-3 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 rounded-xl text-xs font-bold flex items-center gap-1">
                  {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                </button>
              </form>

              {/* ช่องวางลิงก์ URL บนทีวี */}
              <div className="mt-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="text-[11px] font-bold text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition"
                >
                  <LinkIcon size={13} />
                  <span>{showUrlInput ? '▲ ซ่อนช่องใส่ลิงก์' : '🔗 วางลิงก์ YouTube (ไม่เสียโควต้า)'}</span>
                </button>

                {showUrlInput && (
                  <div className="mt-2 p-2 bg-zinc-900 rounded-xl border border-cyan-500/30 space-y-2">
                    <input
                      type="text"
                      value={directUrl}
                      onChange={(e) => setDirectUrl(e.target.value)}
                      placeholder="วางลิงก์ YouTube ที่นี่..."
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-cyan-500 text-white"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleAddDirectUrl(true)}
                        className="px-2 py-1 bg-zinc-800 text-zinc-300 hover:text-white rounded text-[10px] font-bold"
                      >
                        แทรก
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAddDirectUrl(false)}
                        className="px-2 py-1 bg-cyan-500 text-zinc-950 rounded text-[10px] font-bold"
                      >
                        + คิว
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {searchError && <p className="text-[11px] text-rose-400 mt-2">{searchError}</p>}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {/* ผลการค้นหา */}
              {searchResults.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider">ผลการค้นหา</span>
                    <button onClick={() => setSearchResults([])} className="text-[11px] text-zinc-500 hover:text-white">ล้างผล</button>
                  </div>
                  <div className="space-y-1.5">
                    {searchResults.map((song) => (
                      <div key={song.id} className="flex items-center gap-2 p-1.5 rounded-xl bg-zinc-900 border border-zinc-800">
                        <img 
                          src={getThumbnail(song.ytId, song.thumbnail)} 
                          alt="" 
                          className="w-12 h-9 rounded-lg object-cover bg-black shrink-0" 
                        />
                        <div className="truncate flex-1 min-w-0 pr-1">
                          <p className="text-xs font-semibold text-white truncate">{song.title}</p>
                          <p className="text-[10px] text-zinc-400 truncate">{song.artist}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => addSong(song, true)} className="px-2 py-1 bg-zinc-800 text-zinc-300 hover:text-white rounded text-[10px] font-bold">แทรก</button>
                          <button onClick={() => addSong(song, false)} className="px-2 py-1 bg-cyan-500 text-zinc-950 rounded text-[10px] font-bold">+ คิว</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ListMusic size={14} /> คิวเพลง ({queue.length})
                </span>
              </div>

              {queue.length === 0 ? (
                <div className="text-center py-8 text-zinc-600 text-xs">
                  ยังไม่มีเพลงในคิว
                </div>
              ) : (
                queue.map((song, idx) => (
                  <div 
                    key={`${song.id}-${idx}`}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 p-2 rounded-xl bg-zinc-900/80 border transition ${
                      draggedIndex === idx ? 'border-cyan-500 opacity-60' : 'border-zinc-800'
                    }`}
                  >
                    <div className="cursor-grab text-zinc-600 hover:text-cyan-400 shrink-0">
                      <GripVertical size={14} />
                    </div>
                    <span className="text-xs font-bold text-zinc-500 w-3 text-center shrink-0">{idx + 1}</span>
                    <img 
                      src={getThumbnail(song.ytId, song.thumbnail)} 
                      alt="" 
                      className="w-10 h-8 rounded-lg object-cover bg-black shrink-0" 
                    />
                    <div className="truncate flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{song.title}</p>
                      <p className="text-[10px] text-zinc-400 truncate">{song.artist}</p>
                    </div>
                    <button onClick={() => removeQueueItem(idx)} className="text-zinc-500 hover:text-rose-400 p-1 shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal QR Code เชื่อมต่อรีโมท */}
      {showRemoteModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 w-full max-w-sm rounded-3xl p-6 relative">
            <button onClick={() => setShowRemoteModal(false)} className="absolute top-4 right-4 text-zinc-400 hover:text-white">
              <X size={20} />
            </button>

            <div className="text-center mb-4">
              <img src="/logo.svg" alt="Logo" className="w-12 h-12 object-contain mx-auto mb-3" />
              <h3 className="font-bold text-lg text-white">ใช้มือถือเป็นรีโมท</h3>
              <p className="text-xs text-zinc-400 mt-1">
                สแกน QR Code ด้วยกล้องมือถือ เพื่อเริ่มสั่งงาน
              </p>
            </div>

            <div className="flex flex-col items-center justify-center p-4 bg-zinc-950 rounded-2xl border border-zinc-800 mb-4">
              <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48 rounded-xl p-2 bg-white" />
              <div className="text-center mt-3">
                <span className="text-[11px] text-zinc-400 uppercase tracking-wider">รหัสห้อง:</span>
                <div className="text-3xl font-black text-cyan-400 tracking-widest mt-0.5">{roomCode}</div>
              </div>
            </div>

            <div className="text-center text-xs text-zinc-400">
              สถานะ: {connectionStatus === 'connected' ? <span className="text-emerald-400 font-bold">● มือถือเชื่อมต่อแล้ว</span> : <span className="text-amber-400">○ รอการสแกน...</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}