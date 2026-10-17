import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

// Reproduce the existing PaperKnow SVG mark with native macOS drawing, not a
// second branding system. Run on macOS; generated PNG/ICNS/ICO are committed.
const assets = resolve(import.meta.dirname, '../assets');
const scratch = await mkdtemp(join(tmpdir(), 'paperknow-icons-'));
await mkdir(assets, { recursive: true });
const swift = `import AppKit
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
let t = NSAffineTransform(); t.translateX(by: 0, yBy: 1024); t.scaleX(by: 16, yBy: -16); t.concat()
NSColor(srgbRed: 36/255, green: 103/255, blue: 239/255, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x:0,y:0,width:64,height:64),xRadius:16,yRadius:16).fill()
let p = NSBezierPath(); p.windingRule = .evenOdd
p.move(to:NSPoint(x:18,y:12));p.line(to:NSPoint(x:34,y:12));p.line(to:NSPoint(x:46,y:24));p.line(to:NSPoint(x:46,y:30));p.curve(to:NSPoint(x:34,y:42),controlPoint1:NSPoint(x:46,y:37),controlPoint2:NSPoint(x:41,y:42));p.line(to:NSPoint(x:26,y:42));p.line(to:NSPoint(x:26,y:52));p.line(to:NSPoint(x:18,y:52));p.close()
p.move(to:NSPoint(x:26,y:24));p.line(to:NSPoint(x:26,y:34));p.line(to:NSPoint(x:34,y:34));p.curve(to:NSPoint(x:39,y:29),controlPoint1:NSPoint(x:37,y:34),controlPoint2:NSPoint(x:39,y:32));p.line(to:NSPoint(x:39,y:28));p.line(to:NSPoint(x:35,y:24));p.close()
NSColor.white.setFill();p.fill()
let f = NSBezierPath();f.move(to:NSPoint(x:34,y:12));f.line(to:NSPoint(x:34,y:24));f.line(to:NSPoint(x:46,y:24));f.close();NSColor(srgbRed:141/255,green:217/255,blue:1,alpha:1).setFill();f.fill()
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
`;
const source = join(scratch, 'icon.swift');
await writeFile(source, swift);
const png = join(assets, 'icon.png');
execFileSync('/usr/bin/swift', [source, png]);
const iconset = join(scratch, 'icon.iconset');
await mkdir(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    execFileSync('/usr/bin/sips', ['-z', String(size * scale), String(size * scale), png,
      '--out', join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
  }
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(assets, 'icon.icns')]);
const icoPng = join(scratch, '256.png');
execFileSync('/usr/bin/sips', ['-z', '256', '256', png, '--out', icoPng], { stdio: 'ignore' });
const bytes = await readFile(icoPng);
const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
header[8] = 0; header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
header.writeUInt32LE(bytes.length, 14); header.writeUInt32LE(22, 18);
await writeFile(join(assets, 'icon.ico'), Buffer.concat([header, bytes]));
console.log('Brand icons generated: PNG, ICNS, ICO');
