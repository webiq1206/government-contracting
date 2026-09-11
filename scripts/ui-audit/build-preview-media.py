"""Generate clearly labelled screen previews, captions, and transcripts from QA captures.
These are useful preview assets, not recordings of authenticated interactions.
"""
from pathlib import Path
import subprocess, json
from PIL import Image, ImageDraw, ImageFont
root=Path(__file__).resolve().parents[2]
shots=root/'artifacts/redesign/screenshots'; out=root/'public/demos'; frames=root/'artifacts/redesign/media-frames'
out.mkdir(exist_ok=True,parents=True);frames.mkdir(exist_ok=True,parents=True)
font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',27)
small=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',16)
workflows={
 'pipeline':('Find opportunities','pipeline',[
  ('See whose turn it is','The pipeline groups opportunities by work that needs you, work BrostCo is handling, and work waiting on others.'),
  ('Inspect fit and timing','Read the fit score, deadline, and current status. Open the record for the evidence behind a decision.'),
  ('Choose the right view','Use a simple board, a list, all stages, or a table to organize the same opportunities.')]),
 'review':('Make decisions','review',[
  ('Review one decision','Keep the opportunity and its decision brief together while you review.'),
  ('Check what is known','Inspect strengths, risks, missing information, and the time available before you commit.'),
  ('Decide with context','Pursue, pass, or open the full record. Your decision stays connected to the opportunity.')]),
 'subs':('Build your team','subs',[
  ('Find a subcontractor','Search the roster by company, trade, or location. Open filters when you need a narrower view.'),
  ('Check the relationship','Review contact details, qualification status, and past activity before starting the next conversation.'),
  ('Keep work connected','Open the subcontractor record to follow its opportunities, conversations, and required paperwork.')]),
 'opportunity':('Prepare the bid','opportunity-id',[
  ('Start with the next step','The opportunity brings its identity, deadline, owner, and next action together.'),
  ('Open the needed detail','Use the record sections for requirements, subcontractors, pricing, documents, submission, and activity.'),
  ('Review before submission','Expand readiness to find remaining work. Your team handles final review, signatures, and submission.')]),
 'activity':('Track the work','activity',[
  ('See the recorded history','The activity history brings actions, messages, and outcomes into a readable account record.'),
  ('Find the exact event','Search for a company, message, bid, or phrase. Expand filters to narrow the history.'),
  ('Inspect the result','Open event details and the related record to understand what happened and what needs attention.')]),
}
def stamp(seconds):
 return f'{seconds//3600:02}:{seconds//60%60:02}:{seconds%60:02}.000'
def build(slug,scenes):
 cues=[]; lines=['BROSTCO | GUIDED SCREEN PREVIEW','Sample data. This preview uses captured product screens.','']; total=0; entries=[]
 for index,(screen,title,text,duration) in enumerate(scenes):
  image=Image.open(shots/f'{screen}-1280.png').convert('RGB')
  # Preserve the actual captured interface, with a clearly separate preview title.
  image=image.resize((1152,810),Image.Resampling.LANCZOS)
  frame=Image.new('RGB',(1280,960),'#f6f8fb');draw=ImageDraw.Draw(frame)
  draw.text((64,23),title,font=font,fill='#152033')
  draw.text((1110,30),f'{index+1:02} / {len(scenes):02}',font=small,fill='#2457e6')
  frame.paste(image,(64,76));draw.rectangle((63,75,1216,886),outline='#cfd ae7'.replace(' ',''),width=1)
  draw.text((64,919),'BrostCo  /  Guided screen preview  /  Sample data',font=small,fill='#526176')
  path=frames/f'{slug}-{index}.png';frame.save(path)
  entries.extend([f"file '{path}'",f'duration {duration}'])
  cues.append(f'{index+1}\n{stamp(total)} --> {stamp(total+duration)}\n{text}\n')
  lines.extend([f'{stamp(total)}  {title}',text,'']);total+=duration
 entries.append(f"file '{path}'")
 listing=frames/f'{slug}.ffconcat';listing.write_text('\n'.join(entries)+'\n')
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-t',str(total),'-vf','fps=24,format=yuv420p','-c:v','libx264','-preset','veryfast','-crf','23','-movflags','+faststart',str(out/f'{slug}.mp4')],check=True)
 (out/f'{slug}.vtt').write_text('WEBVTT\n\n'+'\n'.join(cues));(out/f'{slug}.txt').write_text('\n'.join(lines))
 print(slug,total,'seconds',flush=True)
 return total
manifest={}
for slug,(title,screen,steps) in workflows.items():manifest[slug]=build(slug,[(screen,heading,text,8) for heading,text in steps])
main=[('today','Start with what needs you','Today puts the work queue and current blockers in view. Choose a task to continue the work.',20)]
for slug,(title,screen,steps) in workflows.items():main.append((screen,title,' '.join([steps[0][1],steps[-1][1]]),20))
manifest['platform-walkthrough']=build('platform-walkthrough',main)
manifest['hero-preview']=build('hero-preview', [('today','Know what needs you','A clear queue connects each task to the next action and its underlying record.',15)])
(out/'manifest.json').write_text(json.dumps({'type':'guided_screen_previews','recorded_interactions':False,'sample_data':True,'durationsSeconds':manifest},indent=2)+'\n')
