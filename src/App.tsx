/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import * as makerjs from 'makerjs';
import { Play, Loader2, Settings2, Code, FileCode2, Sparkles, BoxSelect, Ruler } from 'lucide-react';

interface Parameter {
  name: string;
  min: number;
  max: number;
  value: number;
  step: number;
}

interface GeneratedData {
  parameters: Parameter[];
  code: string;
}

export default function App() {
  const [prompt, setPrompt] = useState('A parametric gear with adjustable teeth count, inner radius, and outer radius.');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState<GeneratedData | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, number>>({});
  const [svgOutput, setSvgOutput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'params' | 'code'>('params');
  const [rightPanelTab, setRightPanelTab] = useState<'preview' | 'makerjs' | 'svg'>('preview');

  const [showModelBBox, setShowModelBBox] = useState(false);
  const [showCustomBBox, setShowCustomBBox] = useState(false);
  const [customBBox, setCustomBBox] = useState<{x: number, y: number, w: number, h: number} | null>(null);
  const [isDrawingBBox, setIsDrawingBBox] = useState(false);
  const [drawStart, setDrawStart] = useState<{x: number, y: number} | null>(null);
  
  const [svgInner, setSvgInner] = useState<string>('');
  const [svgViewBox, setSvgViewBox] = useState<string>('');
  const [extents, setExtents] = useState<any>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getSvgPoint = (e: React.PointerEvent) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!showCustomBBox) return;
    const pt = getSvgPoint(e);
    setDrawStart(pt);
    setCustomBBox({ x: pt.x, y: pt.y, w: 0, h: 0 });
    setIsDrawingBBox(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawingBBox || !drawStart) return;
    const pt = getSvgPoint(e);
    setCustomBBox({
      x: Math.min(drawStart.x, pt.x),
      y: Math.min(drawStart.y, pt.y),
      w: Math.abs(pt.x - drawStart.x),
      h: Math.abs(pt.y - drawStart.y)
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDrawingBBox) return;
    setIsDrawingBBox(false);
    (e.target as Element).releasePointerCapture(e.pointerId);
  };

  const generateModel = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `You are an expert in Maker.js, a library for creating 2D vector drawings.
The user wants to create a parametric graphic/pattern.
You must output a JSON object containing:
1. 'parameters': an array of objects defining the interactive parameters (sliders) for the graphic. Each parameter needs a 'name', 'min', 'max', 'value' (default), and 'step'.
2. 'code': the body of a JavaScript function that takes two arguments: 'makerjs' and 'params'. It must return a valid Maker.js model object (containing 'paths' and/or 'models').

CRITICAL RULES FOR MAKER.JS:
- Paths (e.g., new makerjs.paths.Circle, new makerjs.paths.Line, new makerjs.paths.Arc) MUST be placed in a 'paths' object.
- Models (e.g., new makerjs.models.ConnectTheDots, new makerjs.models.Polygon) MUST be placed in a 'models' object.
- Do NOT put paths inside the 'models' object, or models inside the 'paths' object.
- The signature for ConnectTheDots is: new makerjs.models.ConnectTheDots(isClosed: boolean, points: number[][])

Example of 'code':
"const { radius, count } = params;
const paths = {};
const models = {};
for (let i = 0; i < count; i++) {
  paths['circle' + i] = new makerjs.paths.Circle([i * 10, 0], radius);
}
return { paths, models };"

User request: "${prompt}"`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              parameters: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    min: { type: Type.NUMBER },
                    max: { type: Type.NUMBER },
                    value: { type: Type.NUMBER },
                    step: { type: Type.NUMBER }
                  },
                  required: ["name", "min", "max", "value", "step"]
                }
              },
              code: { type: Type.STRING }
            },
            required: ["parameters", "code"]
          }
        }
      });

      if (!response.text) {
        throw new Error("No response text received from the model.");
      }

      const data = JSON.parse(response.text) as GeneratedData;
      setGeneratedData(data);
      
      const initialValues: Record<string, number> = {};
      data.parameters.forEach(p => {
        initialValues[p.name] = p.value;
      });
      setParamValues(initialValues);
      setActiveTab('params');

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to generate model');
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (!generatedData) return;

    try {
      // Create the function
      const modelFunc = new Function('makerjs', 'params', generatedData.code);
      
      // Execute to get model
      const model = modelFunc(makerjs, paramValues);
      
      // Convert to SVG
      const svg = makerjs.exporter.toSVG(model, {
        stroke: 'currentColor',
        fill: 'none',
        useSvgPathOnly: false
      });
      
      const svgInnerMatch = svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
      setSvgInner(svgInnerMatch ? svgInnerMatch[1] : '');
      const viewBoxMatch = svg.match(/viewBox="([^"]+)"/i);
      setSvgViewBox(viewBoxMatch ? viewBoxMatch[1] : '');
      setExtents(makerjs.measure.modelExtents(model));
      
      setSvgOutput(svg);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Error rendering model: ' + err.message);
    }
  }, [generatedData, paramValues]);

  const vbWidth = extents ? (extents.high[0] - extents.low[0]) : 100;
  const vbHeight = extents ? (extents.high[1] - extents.low[1]) : 100;
  const vbMax = Math.max(vbWidth, vbHeight) || 100;
  const strokeWidth = vbMax * 0.005;
  const fontSize = vbMax * 0.03;

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans">
      {/* Left Panel */}
      <div className="w-1/3 min-w-[350px] max-w-[500px] bg-white border-r border-slate-200 flex flex-col h-full shadow-sm z-10">
        <div className="p-6 border-b border-slate-100">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-indigo-600" />
            PGO
          </h1>
          <p className="text-sm text-slate-500 mt-1">Parametric Graphic Objects</p>
        </div>
        
        <div className="p-6 border-b border-slate-100 flex-shrink-0">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Describe your pattern
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full h-32 p-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all resize-none text-sm"
            placeholder="e.g., A parametric gear with adjustable teeth count..."
          />
          <button
            onClick={generateModel}
            disabled={isGenerating || !prompt.trim()}
            className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isGenerating ? 'Generating...' : 'Generate Pattern'}
          </button>
        </div>

        {error && (
          <div className="p-4 mx-6 mt-6 bg-red-50 border border-red-100 text-red-600 rounded-xl text-sm overflow-auto max-h-32">
            {error}
          </div>
        )}

        {generatedData && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex border-b border-slate-200 px-6 pt-4 gap-4">
              <button
                onClick={() => setActiveTab('params')}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'params' 
                    ? 'border-indigo-600 text-indigo-600' 
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4" />
                  Parameters
                </div>
              </button>
              <button
                onClick={() => setActiveTab('code')}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'code' 
                    ? 'border-indigo-600 text-indigo-600' 
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Code className="w-4 h-4" />
                  Code
                </div>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {activeTab === 'params' ? (
                <div className="space-y-6">
                  {generatedData.parameters.map((param) => (
                    <div key={param.name} className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-sm font-medium text-slate-700 capitalize">
                          {param.name.replace(/([A-Z])/g, ' $1').trim()}
                        </label>
                        <span className="text-xs font-mono bg-slate-100 px-2 py-1 rounded text-slate-600">
                          {paramValues[param.name]}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        value={paramValues[param.name] ?? param.value}
                        onChange={(e) => setParamValues(prev => ({
                          ...prev,
                          [param.name]: parseFloat(e.target.value)
                        }))}
                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                      <div className="flex justify-between text-xs text-slate-400 font-mono">
                        <span>{param.min}</span>
                        <span>{param.max}</span>
                      </div>
                    </div>
                  ))}
                  {generatedData.parameters.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No parameters defined for this model.</p>
                  )}
                </div>
              ) : (
                <div className="h-full">
                  <pre className="bg-slate-900 text-slate-50 p-4 rounded-xl text-xs font-mono overflow-auto h-full">
                    <code>{generatedData.code}</code>
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Preview & Code */}
      <div className="flex-1 bg-slate-100 relative overflow-hidden flex flex-col">
        {/* Top Bar */}
        <div className="h-14 border-b border-slate-200 bg-white flex items-center px-6 justify-between z-20">
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setRightPanelTab('preview')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                rightPanelTab === 'preview'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setRightPanelTab('makerjs')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                rightPanelTab === 'makerjs'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Maker.js Code
            </button>
            <button
              onClick={() => setRightPanelTab('svg')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                rightPanelTab === 'svg'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              SVG Output
            </button>
          </div>
          
          {/* Toolbar */}
          {rightPanelTab === 'preview' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowModelBBox(!showModelBBox)}
                className={`p-2 rounded-md transition-colors ${showModelBBox ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
                title="Toggle Model Bounding Box"
              >
                <BoxSelect className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setShowCustomBBox(!showCustomBBox);
                  if (showCustomBBox) setCustomBBox(null);
                }}
                className={`p-2 rounded-md transition-colors ${showCustomBBox ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
                title="Draw Measurement Box"
              >
                <Ruler className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 relative overflow-auto">
          {rightPanelTab === 'preview' && (
            <>
              {/* Grid Background */}
              <div className="absolute inset-0 z-0" style={{
                backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
                backgroundSize: '24px 24px'
              }}></div>
              
              {svgOutput ? (
                <div className="absolute inset-0 p-8 flex items-center justify-center preview-svg">
                  <svg 
                    ref={svgRef}
                    viewBox={svgViewBox || "0 0 100 100"} 
                    className="w-full h-full drop-shadow-xl overflow-visible"
                    preserveAspectRatio="xMidYMid meet"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                    style={{ cursor: showCustomBBox ? 'crosshair' : 'default' }}
                  >
                    <g 
                      className="text-slate-900"
                      dangerouslySetInnerHTML={{ __html: svgInner }} 
                    />
                    
                    {/* Model Bounding Box */}
                    {showModelBBox && extents && (
                      <g className="text-blue-500 stroke-current">
                        <rect 
                          x={extents.low[0]} 
                          y={-extents.high[1]} 
                          width={extents.high[0] - extents.low[0]} 
                          height={extents.high[1] - extents.low[1]} 
                          fill="none" 
                          strokeWidth={strokeWidth} 
                          strokeDasharray={`${strokeWidth * 2} ${strokeWidth * 2}`} 
                        />
                        <text 
                          x={extents.low[0] + (extents.high[0] - extents.low[0])/2} 
                          y={-extents.high[1] - fontSize * 0.5} 
                          fontSize={fontSize} 
                          textAnchor="middle" 
                          fill="currentColor"
                          fontFamily="monospace"
                        >
                          {(extents.high[0] - extents.low[0]).toFixed(2)}
                        </text>
                        <text 
                          x={extents.high[0] + fontSize * 0.5} 
                          y={-extents.high[1] + (extents.high[1] - extents.low[1])/2 + fontSize * 0.3} 
                          fontSize={fontSize} 
                          textAnchor="start" 
                          fill="currentColor"
                          fontFamily="monospace"
                        >
                          {(extents.high[1] - extents.low[1]).toFixed(2)}
                        </text>
                      </g>
                    )}

                    {/* Custom Bounding Box */}
                    {showCustomBBox && customBBox && (
                      <g className="text-emerald-500 stroke-current">
                        <rect 
                          x={customBBox.x} 
                          y={customBBox.y} 
                          width={customBBox.w} 
                          height={customBBox.h} 
                          fill="rgba(16, 185, 129, 0.1)" 
                          strokeWidth={strokeWidth} 
                          strokeDasharray={`${strokeWidth * 2} ${strokeWidth * 2}`} 
                        />
                        {customBBox.w > 0 && customBBox.h > 0 && (
                          <>
                            <text 
                              x={customBBox.x + customBBox.w/2} 
                              y={customBBox.y - fontSize * 0.5} 
                              fontSize={fontSize} 
                              textAnchor="middle" 
                              fill="currentColor"
                              fontFamily="monospace"
                            >
                              {customBBox.w.toFixed(2)}
                            </text>
                            <text 
                              x={customBBox.x + customBBox.w + fontSize * 0.5} 
                              y={customBBox.y + customBBox.h/2 + fontSize * 0.3} 
                              fontSize={fontSize} 
                              textAnchor="start" 
                              fill="currentColor"
                              fontFamily="monospace"
                            >
                              {customBBox.h.toFixed(2)}
                            </text>
                          </>
                        )}
                      </g>
                    )}
                  </svg>
                </div>
              ) : (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-slate-400">
                  <FileCode2 className="w-16 h-16 mb-4 opacity-50" />
                  <p className="text-sm font-medium">Generate a pattern to see preview</p>
                </div>
              )}
            </>
          )}

          {rightPanelTab === 'makerjs' && (
            <div className="absolute inset-0 bg-slate-900 p-6 overflow-auto">
              {generatedData ? (
                <pre className="text-slate-50 font-mono text-sm leading-relaxed">
                  <code className="text-indigo-300">function</code> <code className="text-blue-300">generateModel</code>(makerjs, params) {'{\n'}
                  <code className="text-slate-300">  {generatedData.code.split('\n').join('\n  ')}</code>
                  {'\n}'}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">
                  <p className="text-sm font-medium">No code generated yet</p>
                </div>
              )}
            </div>
          )}

          {rightPanelTab === 'svg' && (
            <div className="absolute inset-0 bg-slate-900 p-6 overflow-auto">
              {svgOutput ? (
                <pre className="text-slate-50 font-mono text-sm leading-relaxed">
                  <code>{svgOutput}</code>
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500">
                  <p className="text-sm font-medium">No SVG generated yet</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

