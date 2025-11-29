
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Volume2, VolumeX, Clock, Plus, Maximize, Minimize, Mic, MicOff, Loader2, XCircle, Key } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { Task, SoundType, AppSettings } from './types';
import { playSound } from './utils/audio';
import { Button } from './components/Button';
import { createPcmBlob, base64ToBytes, decodeAudioData } from './utils/pcm';

// Default settings
const TIMER_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Safe environment variable accessor
const getEnvApiKey = () => {
  try {
    // @ts-ignore
    return (typeof process !== 'undefined' && process.env) ? process.env.API_KEY : '';
  } catch {
    return '';
  }
};

// Simple ID generator fallback
const generateId = () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

const App: React.FC = () => {
  // --- State ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inputText, setInputText] = useState('');
  const [settings, setSettings] = useState<AppSettings>({
    soundEnabled: true,
    timerEnabled: true,
    timerIntervalMinutes: 30,
  });
  const [timeLeft, setTimeLeft] = useState<number>(TIMER_INTERVAL_MS);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [customApiKey, setCustomApiKey] = useState<string>('');
  
  // Voice State
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isVoiceConnecting, setIsVoiceConnecting] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);

  // Refs for logic/audio
  const timerRef = useRef<number | null>(null);
  const tasksRef = useRef<Task[]>([]); // Ref to access latest tasks in closures
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Load API Key from local storage on mount (Safe)
  useEffect(() => {
    try {
      const storedKey = localStorage.getItem('gemini_api_key');
      if (storedKey) setCustomApiKey(storedKey);
    } catch (e) {
      console.warn("LocalStorage unavailable for reading key");
    }
  }, []);

  // Keep tasks ref in sync
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // --- Persistence (Safe) ---
  useEffect(() => {
    try {
      const savedTasks = localStorage.getItem('tasks');
      if (savedTasks) {
        setTasks(JSON.parse(savedTasks));
      }
    } catch (e) {
      console.warn("LocalStorage unavailable for reading tasks");
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('tasks', JSON.stringify(tasks));
    } catch (e) {
      console.warn("LocalStorage unavailable for saving tasks");
    }
  }, [tasks]);

  // --- Audio ---
  const triggerSound = useCallback((type: SoundType) => {
    if (settings.soundEnabled) {
      playSound(type);
    }
  }, [settings.soundEnabled]);

  // --- Timer Logic ---
  useEffect(() => {
    if (settings.timerEnabled) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1000) {
            triggerSound(SoundType.ALARM);
            return TIMER_INTERVAL_MS; // Reset
          }
          return prev - 1000;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setTimeLeft(TIMER_INTERVAL_MS);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [settings.timerEnabled, triggerSound]);

  // --- Fullscreen Logic ---
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
          setIsFullscreen(false);
        }
      }
    } catch (err) {
      console.error("Error attempting to toggle full-screen mode", err);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // --- Task Handlers ---
  const addTask = (text: string) => {
    if (!text.trim()) return;
    const newTask: Task = {
      id: generateId(),
      text: text,
      completed: false,
      createdAt: Date.now(),
    };
    setTasks(prev => [newTask, ...prev]);
    triggerSound(SoundType.ADD);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addTask(inputText);
    setInputText('');
  };

  const deleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
    triggerSound(SoundType.DELETE);
  };

  const clearAllTasks = () => {
    setTasks([]);
    triggerSound(SoundType.DELETE);
  };

  const toggleComplete = (id: string) => {
    setTasks(prev => prev.map(t => 
      t.id === id ? { ...t, completed: !t.completed } : t
    ));
    triggerSound(SoundType.CLICK);
  };

  const toggleSound = () => {
    setSettings(prev => ({ ...prev, soundEnabled: !prev.soundEnabled }));
  };

  const toggleTimer = () => {
    setSettings(prev => ({ ...prev, timerEnabled: !prev.timerEnabled }));
    triggerSound(SoundType.CLICK);
  };

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // --- Voice / Gemini Live API Logic ---
  const handleSetKey = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
    } else {
      const key = prompt("Enter your Gemini API Key:", customApiKey);
      if (key) {
        try {
          localStorage.setItem('gemini_api_key', key);
        } catch {}
        setCustomApiKey(key);
      }
    }
  };

  const disconnectVoice = useCallback(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current = null;
    }
    
    // Stop input stream
    if (inputContextRef.current) {
      inputContextRef.current.close();
      inputContextRef.current = null;
    }

    // Stop output audio
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();
    
    setIsVoiceActive(false);
    setIsVoiceConnecting(false);
    setIsBotSpeaking(false);
  }, []);

  const connectVoice = async () => {
    let apiKey = customApiKey;

    // Check key availability priority: AIStudio > LocalStorage > Process Env
    if ((window as any).aistudio) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        const success = await (window as any).aistudio.openSelectKey();
        if (!success) {
          setVoiceError("API Key required");
          return;
        }
      }
      // Re-fetch key from env if set by aistudio
    }
    
    // Safe check for process.env using helper
    const envKey = getEnvApiKey();
    if (!apiKey && envKey) {
      apiKey = envKey;
    }

    if (!apiKey && !(window as any).aistudio) {
      // If no key, prompt for it immediately
      await handleSetKey();
      // Check again after prompt
      try {
        apiKey = localStorage.getItem('gemini_api_key') || '';
      } catch {}
      
      if (!apiKey) {
        setVoiceError("No API Key set.");
        return;
      }
    }

    setIsVoiceConnecting(true);
    setVoiceError(null);

    try {
      // 1. Setup Audio Input
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      inputContextRef.current = inputCtx;

      // 2. Setup Audio Output
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outputCtx;
      
      // 3. Initialize Gemini
      const ai = new GoogleGenAI({ apiKey: apiKey || getEnvApiKey() });
      
      // Tool Definitions
      const tools: FunctionDeclaration[] = [
        {
          name: 'addTask',
          description: 'Add a new item to the to-do list.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: 'The text content of the task' }
            },
            required: ['text']
          }
        },
        {
          name: 'removeTask',
          description: 'Remove a task from the list by matching its text content.',
          parameters: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING, description: 'The text content of the task to remove' }
            },
            required: ['text']
          }
        },
        {
          name: 'getTasks',
          description: 'Get the current list of tasks to read them to the user.',
          parameters: {
             type: Type.OBJECT,
             properties: {},
          }
        },
        {
          name: 'clearAllTasks',
          description: 'Delete all tasks in the list. Use with caution.',
          parameters: {
            type: Type.OBJECT,
            properties: {}
          }
        }
      ];

      // 4. Connect Session
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: "You are FocusTask, a witty and high-energy productivity assistant. You manage the user's to-do list. Keep your responses short, motivating, and punchy. When the user asks to add or remove tasks, use the provided tools immediately. Do not just say you will do it, actually call the function.",
          tools: [{ functionDeclarations: tools }],
        },
        callbacks: {
          onopen: () => {
            console.log("Voice Session Opened");
            setIsVoiceConnecting(false);
            setIsVoiceActive(true);
            
            // Start streaming input
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const blob = createPcmBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: blob }));
            };
            
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Audio Output
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && audioContextRef.current) {
               setIsBotSpeaking(true);
               const ctx = audioContextRef.current;
               nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
               
               try {
                 const buffer = await decodeAudioData(base64ToBytes(audioData), ctx);
                 const source = ctx.createBufferSource();
                 source.buffer = buffer;
                 source.connect(ctx.destination);
                 
                 source.onended = () => {
                    audioSourcesRef.current.delete(source);
                    if (audioSourcesRef.current.size === 0) setIsBotSpeaking(false);
                 };
                 
                 source.start(nextStartTimeRef.current);
                 nextStartTimeRef.current += buffer.duration;
                 audioSourcesRef.current.add(source);
               } catch (e) {
                 console.error("Audio Decode Error", e);
               }
            }

            // Handle Interruptions
            if (msg.serverContent?.interrupted) {
              audioSourcesRef.current.forEach(s => s.stop());
              audioSourcesRef.current.clear();
              nextStartTimeRef.current = 0;
              setIsBotSpeaking(false);
            }

            // Handle Tool Calls
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                let result = "ok";
                if (fc.name === 'addTask') {
                   const text = (fc.args as any).text;
                   addTask(text);
                   result = `Added task: ${text}`;
                } else if (fc.name === 'removeTask') {
                   const text = (fc.args as any).text;
                   const taskToRemove = tasksRef.current.find(t => t.text.toLowerCase().includes(text.toLowerCase()));
                   if (taskToRemove) {
                     deleteTask(taskToRemove.id);
                     result = `Removed task: ${taskToRemove.text}`;
                   } else {
                     result = `Could not find task matching ${text}`;
                   }
                } else if (fc.name === 'getTasks') {
                   const list = tasksRef.current.map(t => t.text).join(', ');
                   result = list ? `Your list has: ${list}` : "Your list is empty.";
                } else if (fc.name === 'clearAllTasks') {
                  clearAllTasks();
                  result = "All tasks cleared.";
                }

                // Send response back
                sessionPromise.then(session => session.sendToolResponse({
                  functionResponses: {
                    id: fc.id,
                    name: fc.name,
                    response: { result }
                  }
                }));
              }
            }
          },
          onclose: () => {
             console.log("Session Closed");
             disconnectVoice();
          },
          onerror: (err) => {
            console.error("Session Error", err);
            setVoiceError("Connection failed");
            disconnectVoice();
          }
        }
      });
      
      liveSessionRef.current = sessionPromise;

    } catch (e) {
      console.error("Voice Init Failed", e);
      setVoiceError("Could not start voice");
      setIsVoiceConnecting(false);
    }
  };

  const toggleVoice = () => {
    if (isVoiceActive || isVoiceConnecting) {
      disconnectVoice();
    } else {
      connectVoice();
    }
  };

  const isKeyMissing = !customApiKey && !getEnvApiKey();

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-start p-4 md:p-6 font-sans">
      
      {/* Container */}
      <div 
        className={`
          w-full max-w-lg flex flex-col h-full max-h-[90vh] bg-gray-900 border-2 rounded-xl shadow-2xl overflow-hidden relative transition-all duration-500
          ${isVoiceActive ? 'shadow-red-900/50' : ''}
          ${isBotSpeaking ? 'border-green-400 shadow-[0_0_30px_rgba(74,222,128,0.3)]' : isVoiceActive ? 'border-red-500' : 'border-gray-700'}
        `}
      >
        
        {/* Header */}
        <div className="bg-gray-800 p-4 border-b border-gray-700 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <h1 className={`text-2xl font-black tracking-tighter uppercase transition-colors duration-300 ${isBotSpeaking ? 'text-green-400' : isVoiceActive ? 'text-red-500' : 'text-yellow-400'}`}>
              {isBotSpeaking ? 'Speaking...' : isVoiceActive ? 'Listening...' : 'FocusTask'}
            </h1>
          </div>
          
          <div className="flex gap-2">
             {/* Key Button */}
            <Button 
              variant="icon" 
              onClick={handleSetKey} 
              title="Set API Key"
              className={`flex items-center gap-1 ${customApiKey ? "text-yellow-400" : "text-red-400 bg-red-900/20 animate-pulse border border-red-500/50"}`}
            >
              <Key size={20} />
              {!customApiKey && <span className="text-xs font-bold px-1">SET KEY</span>}
            </Button>

             {/* Voice Button */}
            <Button 
              variant="icon" 
              onClick={toggleVoice} 
              title="Voice Assistant"
              className={`transition-all ${isVoiceActive ? 'bg-red-500/20 text-red-500 animate-pulse-red' : ''}`}
            >
              {isVoiceConnecting ? <Loader2 size={24} className="animate-spin" /> : 
               isVoiceActive ? <Mic size={24} /> : <MicOff size={24} />}
            </Button>

            <Button 
              variant="icon" 
              onClick={toggleFullscreen} 
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
            </Button>
            <Button 
              variant="icon" 
              onClick={toggleTimer} 
              className={settings.timerEnabled ? "text-green-400" : "text-gray-500"}
            >
              <div className="flex items-center gap-1 font-mono text-sm font-bold">
                 <Clock size={24} />
                 {settings.timerEnabled && <span>{formatTime(timeLeft)}</span>}
              </div>
            </Button>
            <Button 
              variant="icon" 
              onClick={toggleSound} 
            >
              {settings.soundEnabled ? <Volume2 size={24} className="text-blue-400" /> : <VolumeX size={24} />}
            </Button>
          </div>
        </div>
        
        {voiceError && (
          <div className="bg-red-900/50 text-red-200 text-xs text-center p-1">
            {voiceError}
          </div>
        )}

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 relative">
          {tasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-4">
              <div className="text-center opacity-50">
                <p className="text-xl font-bold">NO TASKS</p>
                <p>Add something below</p>
              </div>
              
              <div className="w-full max-w-xs h-px bg-gray-800 my-4"></div>

              {/* Central Voice Setup / Connect Button */}
              <button 
                 onClick={toggleVoice}
                 className={`
                    flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-dashed
                    transition-all duration-300 group
                    ${isKeyMissing 
                       ? 'border-red-500/50 bg-red-900/10 hover:bg-red-900/20 text-red-400' 
                       : 'border-yellow-500/30 bg-yellow-900/10 hover:bg-yellow-900/20 text-yellow-500'}
                 `}
              >
                 <div className={`p-4 rounded-full ${isKeyMissing ? 'bg-red-500/20' : 'bg-yellow-500/20'} group-hover:scale-110 transition-transform`}>
                    <Mic size={32} />
                 </div>
                 <span className="font-bold text-lg">
                    {isKeyMissing ? "1. Connect Voice Assistant" : "Start Voice Session"}
                 </span>
                 {isKeyMissing && <span className="text-xs opacity-75">(Requires API Key)</span>}
              </button>

            </div>
          ) : (
            tasks.map(task => (
              <div 
                key={task.id} 
                className={`
                  flex items-center justify-between p-3 rounded-lg border-l-4 transition-all
                  ${task.completed ? 'bg-gray-800 border-gray-600 opacity-60' : 'bg-gray-800 border-yellow-400'}
                `}
              >
                <div 
                  className="flex-1 cursor-pointer p-2"
                  onClick={() => toggleComplete(task.id)}
                >
                  <span className={`text-xl font-bold ${task.completed ? 'line-through text-gray-500' : 'text-white'}`}>
                    {task.text}
                  </span>
                </div>
                
                <Button 
                  variant="danger" 
                  onClick={() => deleteTask(task.id)}
                  className="ml-3 shrink-0"
                >
                  <Trash2 size={24} />
                </Button>
              </div>
            ))
          )}
        </div>

        {/* Input Area */}
        <div className="bg-gray-800 p-4 border-t border-gray-700 shrink-0">
          <form onSubmit={handleFormSubmit} className="flex flex-col gap-3">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="What needs doing?"
              className="w-full bg-gray-950 text-white text-xl p-4 rounded-lg border-2 border-gray-600 focus:border-yellow-400 focus:outline-none placeholder-gray-600 font-bold"
            />
            <Button 
              type="submit" 
              large 
              className="w-full flex items-center justify-center gap-2 shadow-lg shadow-yellow-900/20"
            >
              <Plus size={28} strokeWidth={3} />
              ADD TASK
            </Button>
          </form>
        </div>

      </div>

      <div className="mt-4 text-gray-500 text-sm font-mono text-center">
        Data saved locally.
      </div>

    </div>
  );
};

export default App;
