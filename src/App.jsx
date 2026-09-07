import React, { useState, useEffect, useRef } from 'react';
import Peer from 'peerjs';
import { 
  Play, Pause, SkipForward, RotateCcw, Search, 
  Mic, Disc3, Settings, QrCode, Smartphone, 
  ListMusic, PartyPopper, Sparkles, X, Check, ExternalLink 
} from 'lucide-react';

// รายการเพลงเริ่มต้น (ใช้ Video ID คลิปคาราโอเกะจริงที่เปิดบนเว็บได้แน่นอน)
const DEFAULT_PRESETS = [
  { id: 'kJQP7kiw5Fk', ytId: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito (Karaoke Version)', artist: 'Sing King', isKaraoke: true },
  { id: 'fJ9rUzIMcZQ', ytId: 'fJ9rUzIMcZQ', title: 'Queen - Bohemian Rhapsody (Karaoke)', artist: 'KaraokeOnVEVO', isKaraoke: true },
  { id: 'JGwWNGJdvx8', ytId: 'JGwWNGJdvx8', title: 'Ed Sheeran - Shape of You', artist: 'Ed Sheeran', isKaraoke: false },
  { id: '450p7goxZqg', ytId: '450p7goxZqg', title: 'John Legend - All of Me (Karaoke Version)', artist: 'Sing King', isKaraoke: true },
];

export default function App() {
  // สถานะเพลงและคิว
  const [currentSong, setCurrentSong] = useState(DEFAULT_PRESETS[0]);
  const [queue, setQueue] = useState(DEFAULT_PRESETS.slice(1));
  const [isPlaying, setIsPlaying] = useState(true);

  // ระบบค้นหา & YouTube API
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('yt_api_key') || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState('karaoke'); // 'karaoke' | 'original'
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // การเชื่อมต่อรีโมท (WebRTC)
  const [roomCode, setRoomCode] = useState('');
  const [connectedDevices, setConnectedDevices] = useState(0);
  const [isRemoteMode, setIsRemoteMode] = useState(false);
  const [inputRoomCode, setInputRoomCode] = useState('');

  // หน้าต่าง Modal ป๊อปอัป
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const ytPlayerRef = useRef(null);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  // 1. ตรวจสอบว่าเปิดมาจาก QR Code รีโมทหรือไม่ (?room=XXXX)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInputRoomCode(roomParam.toUpperCase());
      setIsRemoteMode(true);
      connectAsRemote(roomParam.toUpperCase());
    } else {
      initHostPlayer();
    }
    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // 2. เริ่มระบบโฮสต์หลัก (เปิดเว็บมาเป็นโฮสต์พร้อมเล่นทันที + รอรีโมทเชื่อมต่อเงียบๆ)
  const initHostPlayer = () => {
    // โหลด YouTube IFrame API
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
      setConnectedDevices((prev) => prev + 1);

      // ส่งคิวปัจจุบันไปให้รีโมท
      setTimeout(() => {
        conn.send({ type: 'SYNC', queue: queueRef.current, currentSong });
      }, 500);

      conn.on('data', (data) => {
        switch (data.type) {
          case 'ADD_QUEUE':
            setQueue((prev) => [...prev, data.song]);
            break;
          case 'PLAY_NEXT_NOW':
            setQueue((prev) => [data.song, ...prev]);
            break;
          case 'SKIP':
            handleNextSong();
            break;
          case 'REPLAY':
            if (ytPlayerRef.current?.seekTo) {
              ytPlayerRef.current.seekTo(0);
              ytPlayerRef.current.playVideo();
            }
            break;
          case 'SFX':
            playSfx(data.sound);
            break;
          default:
            break;
        }
      });

      conn.on('close', () => setConnectedDevices((prev) => Math.max(0, prev - 1)));
    });
  };

  // 3. ควบคุมเครื่องเล่น YouTube
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
        setCurrentSong(next);
        return prev.slice(1);
      }
      return prev;
    });
  };

  // 4. สลับไปโหมดรีโมทมือถือ
  const connectAsRemote = (code) => {
    const targetCode = (code || inputRoomCode).trim().toUpperCase();
    if (!targetCode) return;

    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', () => {
      const conn = peer.connect(`KARAOKE-${targetCode}`);
      connRef.current = conn;
      conn.on('open', () => {
        setIsRemoteMode(true);
        setShowRemoteModal(false);
      });
    });
  };

  const sendCommand = (payload) => {
    if (connRef.current) {
      connRef.current.send(payload);
    }
  };

  // เสียง Sound Effect (Synthesized)
  const playSfx = (type) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (type === 'applause') {
        const bufferSize = ctx.sampleRate * 1.5;
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
        osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch (e) {
      console.log(e);
    }
  };

  // ค้นหาเพลงผ่าน YouTube Data API v3
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;

    if (!apiKey) {
      setShowSettingsModal(true);
      return;
    }

    setIsSearching(true);
    try {
      const query = searchMode === 'karaoke' 
        ? `${searchQuery.trim()} คาราโอเกะ karaoke` 
        : `${searchQuery.trim()} official mv`;

      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${encodeURIComponent(query)}&key=${apiKey}`
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      const items = (data.items || []).map((item) => ({
        id: item.id.videoId,
        ytId: item.id.videoId,
        title: item.snippet.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
        artist: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.medium?.url,
        isKaraoke: searchMode === 'karaoke',
      }));
      setSearchResults(items);
    } catch (err) {
      alert('ค้นหาไม่สำเร็จ: ' + err.message);
    } finally {
      setIsSearching(false);
    }
  };

  const addSong = (song, playNext = false) => {
    if (isRemoteMode) {
      sendCommand({ type: playNext ? 'PLAY_NEXT_NOW' : 'ADD_QUEUE', song });
    } else {
      if (playNext) {
        setQueue((prev) => [song, ...prev]);
      } else {
        setQueue((prev) => [...prev, song]);
      }
    }
  };

  // =============================================================
  // หน้าต่างเฉพาะโหมดรีโมทมือถือ (เมื่อสแกนเข้ามา)
  // =============================================================
  if (isRemoteMode) {
    return (
      <div className="max-w-md mx-auto min-h-screen p-4 flex flex-col text-slate-100">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Smartphone className="text-purple-400" size={20} />
            <span className="font-bold">รีโมทควบคุมทีวี</span>
          </div>
          <button 
            onClick={() => { setIsRemoteMode(false); window.location.search = ''; }}
            className="text-xs text-slate-400 hover:text-white"
          >
            สลับเป็นหน้าเล่นปกติ
          </button>
        </div>

        {/* ปุ่มควบคุมด่วน & ซาวด์เอฟเฟกต์ */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <button onClick={() => sendCommand({ type: 'SKIP' })} className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 active:scale-95">
            <SkipForward size={18} className="text-purple-400" /> ข้ามเพลง
          </button>
          <button onClick={() => sendCommand({ type: 'REPLAY' })} className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 active:scale-95">
            <RotateCcw size={18} className="text-purple-400" /> ร้องใหม่
          </button>
          <button onClick={() => sendCommand({ type: 'SFX', sound: 'applause' })} className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 active:scale-95">
            <PartyPopper size={18} className="text-pink-400" /> ปรบมือ 👏
          </button>
          <button onClick={() => sendCommand({ type: 'SFX', sound: 'cheer' })} className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs font-semibold flex flex-col items-center gap-1 active:scale-95">
            <Sparkles size={18} className="text-amber-400" /> หวูดแตร 🎺
          </button>
        </div>

        {/* ค้นหาเพลง */}
        <div className="p-3 bg-slate-900 rounded-2xl border border-slate-800 mb-4">
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setSearchMode('karaoke')}
              className={`flex-1 py-1 text-xs font-bold rounded-lg ${searchMode === 'karaoke' ? 'bg-purple-600 text-white' : 'text-slate-400'}`}
            >
              🎤 คาราโอเกะ
            </button>
            <button
              onClick={() => setSearchMode('original')}
              className={`flex-1 py-1 text-xs font-bold rounded-lg ${searchMode === 'original' ? 'bg-purple-600 text-white' : 'text-slate-400'}`}
            >
              🎵 เพลงต้นฉบับ
            </button>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="พิมพ์ชื่อเพลง..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-purple-500"
            />
            <button type="submit" className="px-3 bg-purple-600 rounded-xl text-xs font-bold">
              ค้นหา
            </button>
          </form>
        </div>

        {/* ผลลัพธ์ / เพลงแนะนำ */}
        <div className="space-y-2 overflow-y-auto flex-1">
          {(searchResults.length > 0 ? searchResults : DEFAULT_PRESETS).map((song) => (
            <div key={song.id} className="flex items-center justify-between p-2.5 bg-slate-900 border border-slate-800 rounded-xl">
              <div className="truncate flex-1 pr-2">
                <p className="text-xs font-semibold truncate text-white">{song.title}</p>
                <p className="text-[11px] text-slate-400 truncate">{song.artist}</p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => addSong(song, true)} className="px-2 py-1 bg-pink-600/20 text-pink-300 rounded text-[10px] font-bold">
                  แทรกคิว
                </button>
                <button onClick={() => addSong(song, false)} className="px-2 py-1 bg-purple-600 text-white rounded text-[10px] font-bold">
                  + จอง
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // =============================================================
  // หน้าหลัก: คาราโอเกะตัวเต็ม (ใช้งานได้ทันทีบนจอคอม/ทีวี/มือถือ)
  // =============================================================
  const remoteConnectUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(remoteConnectUrl)}`;

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* แถบเมนูด้านบน */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-purple-600/20 text-purple-400">
            <Mic size={22} />
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight">Karaoke Station</h1>
            <p className="text-[11px] text-slate-400">ร้องคาราโอเกะออนไลน์ฟรี</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* ปุ่มตัวเลือกเชื่อมต่อรีโมท */}
          <button
            onClick={() => setShowRemoteModal(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 transition shadow-lg shadow-purple-600/20"
          >
            <Smartphone size={15} />
            <span>เชื่อมต่อรีโมท</span>
            {connectedDevices > 0 && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </button>

          {/* ปุ่มตั้งค่า API Key */}
          <button
            onClick={() => setShowSettingsModal(true)}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
            title="ตั้งค่า YouTube API"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {/* พื้นที่แสดงผลหลัก */}
      <div className="flex flex-1 flex-col lg:flex-row overflow-hidden">
        {/* ฝั่งซ้าย: ตัวเล่นวิดีโอ & ควบคุม */}
        <div className="flex-1 flex flex-col bg-black">
          <div className="relative flex-1 flex items-center justify-center bg-black">
            <div id="karaoke-player" className="w-full h-full" />
          </div>

          {/* แถบสถานะเพลงที่กำลังเล่น */}
          <div className="flex items-center justify-between p-4 bg-slate-900 border-t border-slate-800">
            <div className="flex items-center gap-3 truncate">
              <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-300 rounded-md font-semibold">
                {currentSong?.isKaraoke ? '🎤 คาราโอเกะ' : '🎵 เพลงปกติ'}
              </span>
              <div className="truncate">
                <h2 className="text-sm font-bold text-white truncate">{currentSong?.title}</h2>
                <p className="text-xs text-slate-400 truncate">{currentSong?.artist}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => playSfx('applause')}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 active:scale-95"
                title="เสียงปรบมือ"
              >
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
                title="ร้องซ้ำ"
              >
                <RotateCcw size={18} />
              </button>
              <button
                onClick={handleNextSong}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition shadow active:scale-95"
              >
                <SkipForward size={16} /> ข้ามเพลง
              </button>
            </div>
          </div>
        </div>

        {/* ฝั่งขวา: ค้นหาเพลง & รายการคิว */}
        <div className="w-full lg:w-96 border-l border-slate-800 bg-slate-950 flex flex-col h-72 lg:h-full">
          {/* ช่องค้นหา */}
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
              <button
                type="submit"
                disabled={isSearching}
                className="px-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center gap-1"
              >
                <Search size={14} />
              </button>
            </form>
          </div>

          {/* รายการเพลง (ผลการค้นหา หรือ คิวเพลง) */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {searchResults.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-purple-400 uppercase tracking-wider">ผลการค้นหา</span>
                  <button onClick={() => setSearchResults([])} className="text-[11px] text-slate-500 hover:text-white">ล้างผลลัพธ์</button>
                </div>
                <div className="space-y-1.5">
                  {searchResults.map((song) => (
                    <div key={song.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-900 border border-slate-800">
                      <div className="truncate flex-1 pr-2">
                        <p className="text-xs font-semibold text-white truncate">{song.title}</p>
                        <p className="text-[10px] text-slate-400 truncate">{song.artist}</p>
                      </div>
                      <div className="flex gap-1">
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

            {queue.length === 0 ? (
              <div className="text-center py-8 text-slate-600 text-xs">
                ไม่มีเพลงในคิว ค้นหาหรือเลือกเพลงด้านล่างได้เลย
              </div>
            ) : (
              queue.map((song, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded-xl bg-slate-900/70 border border-slate-800/80">
                  <div className="flex items-center gap-2 truncate flex-1">
                    <span className="text-xs font-bold text-slate-500 w-4 text-center">{idx + 1}</span>
                    <div className="truncate">
                      <p className="text-xs font-semibold text-white truncate">{song.title}</p>
                      <p className="text-[10px] text-slate-400 truncate">{song.artist}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setQueue((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-500 hover:text-rose-400 p-1"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))
            )}

            {/* เพลงแนะนำเริ่มต้น */}
            <div className="pt-3 border-t border-slate-800/80">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">เพลงแนะนำ</span>
              <div className="space-y-1.5">
                {DEFAULT_PRESETS.map((song) => (
                  <div key={song.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-900/40 border border-slate-800/50">
                    <div className="truncate flex-1 pr-2">
                      <p className="text-xs font-semibold text-slate-300 truncate">{song.title}</p>
                    </div>
                    <button onClick={() => addSong(song, false)} className="px-2 py-0.5 bg-slate-800 hover:bg-purple-600 text-slate-300 hover:text-white rounded text-[10px] font-bold">
                      + คิว
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================= */}
      {/* Modal: เชื่อมต่อรีโมทมือถือ */}
      {/* ============================================================= */}
      {showRemoteModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-6 relative">
            <button
              onClick={() => setShowRemoteModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>

            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-2xl bg-purple-600/20 text-purple-400 mx-auto flex items-center justify-center mb-3">
                <QrCode size={24} />
              </div>
              <h3 className="font-bold text-lg text-white">ใช้มือถือเป็นรีโมท</h3>
              <p className="text-xs text-slate-400 mt-1">
                สแกน QR Code ด้วยกล้องมือถือ เพื่อเปิดหน้ารีโมทค้นหาเพลง
              </p>
            </div>

            <div className="flex flex-col items-center justify-center p-4 bg-slate-950 rounded-2xl border border-slate-800 mb-4">
              <img src={qrCodeUrl} alt="QR Code" className="w-44 h-44 rounded-xl p-2 bg-white" />
              <div className="text-center mt-3">
                <span className="text-[11px] text-slate-400 uppercase tracking-wider">หรือใส่รหัสห้อง:</span>
                <div className="text-2xl font-black text-purple-400 tracking-widest mt-0.5">{roomCode}</div>
              </div>
            </div>

            {/* ทางเลือก: นำเครื่องนี้ไปคุมจออื่น */}
            <div className="pt-4 border-t border-slate-800">
              <p className="text-xs text-slate-400 mb-2">หรือต้องการใช้หน้านี้ไปคุมจออื่น?</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  maxLength={4}
                  value={inputRoomCode}
                  onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())}
                  placeholder="รหัส 4 หลัก"
                  className="w-28 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-center font-bold uppercase focus:outline-none"
                />
                <button
                  onClick={() => connectAsRemote(inputRoomCode)}
                  className="flex-1 bg-slate-800 hover:bg-slate-700 rounded-xl text-xs font-bold transition"
                >
                  เชื่อมต่อ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* Modal: ตั้งค่า YouTube API Key */}
      {/* ============================================================= */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-sm rounded-3xl p-6 relative">
            <button
              onClick={() => setShowSettingsModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X size={20} />
            </button>

            <h3 className="font-bold text-base text-white mb-2">ตั้งค่า YouTube API Key</h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              ใส่ Google API Key ที่คุณสร้าง เพื่อให้ระบบสามารถพิมพ์ค้นหาเพลงคาราโอเกะอะไรก็ได้แบบสดๆ
            </p>

            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                localStorage.setItem('yt_api_key', e.target.value);
              }}
              placeholder="AIzaSy..."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs mb-4 focus:outline-none focus:border-purple-500"
            />

            <button
              onClick={() => setShowSettingsModal(false)}
              className="w-full py-2 bg-purple-600 hover:bg-purple-500 rounded-xl text-xs font-bold text-white transition"
            >
              บันทึกและปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
}