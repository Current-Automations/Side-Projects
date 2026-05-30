import io, random, textwrap, threading, time, tkinter as tk
from tkinter import ttk, messagebox
import requests
from PIL import Image, ImageTk

# ─────────────────────────── static data
API_ROOT = "https://pokeapi.co/api/v2"
ART_URL  = ("https://raw.githubusercontent.com/PokeAPI/sprites/master/"
            "sprites/pokemon/other/official-artwork/{id}.png")

REGIONS = {
    "Kanto":   range(1, 152),
    "Johto":   range(152, 252),
    "Hoenn":   range(252, 387),
    "Sinnoh":  range(387, 494),
    "Unova":   range(494, 650),
    "Kalos":   range(650, 722),
    "Alola":   range(722, 810),
    "Galar":   range(810, 906),
    "Paldea":  range(906, 1026),
    "National":range(1, 1026),
}

CLUE_PRESETS = {
    "Classic":      ["types","genus_colour","height_weight","abilities","hab_gen","flavour"],
    "Mystery":      "RANDOM",
    "Stats-First":  ["height_weight","types","abilities","hab_gen","genus_colour","flavour"],
    "Lore-First":   ["flavour","hab_gen","genus_colour","types","abilities","height_weight"],
    "Colour-First": ["genus_colour","types","abilities","height_weight","hab_gen","flavour"],
}

DRINK_RULES = {
    "Lame":        "Drink ur water pal 🫗",
    "Casual":      "Drink!",
    "Crushing":    "Take a sip.",
    "Blackout":    "Big gulp!",
    "DO NOT PRESS":"Drink for 3 Mississippi's!",
}

MAX_GUESSES   = 3
COUNTDOWN_SEC = 10
SHOT_CHANCE   = 0.05
HEADER_FONT   = ("Helvetica", 22, "bold")
DEFAULT_FONT  = ("Helvetica", 16)
DEX_FONT      = ("Helvetica", 16)

# ─────────────────────────── helpers
def j(url):             return requests.get(url, timeout=15).json()
def species(i):         return j(f"{API_ROOT}/pokemon-species/{i}")
def pokemon(i):         return j(f"{API_ROOT}/pokemon/{i}")
def artwork(i):
    return Image.open(io.BytesIO(
        requests.get(ART_URL.format(id=i), timeout=15).content)
    ).convert("RGBA")

def silhouette(img):
    r,g,b,a = img.split()
    blk = Image.new("RGBA", img.size, (0,0,0,255))
    out = Image.composite(blk, Image.new("RGBA", img.size,(0,0,0,0)), a)
    out.putalpha(a); return out

def wrap(txt,w=60): return "\n".join(textwrap.wrap(txt,w))

# ─────────────────────────── Round
class Round:
    def __init__(self, idx:int, preset:str):
        self.idx=idx
        self.spec=species(idx); self.poke=pokemon(idx)
        self.name=self.spec["name"].capitalize()
        self.col=artwork(idx); self.sil=silhouette(self.col)
        self.clues=self._build_clues()
        self.queue=self._order(preset)

    def _order(self,p):
        if p=="Mystery" or CLUE_PRESETS[p]=="RANDOM":
            keys=list(self.clues); random.shuffle(keys)
            return [self.clues[k] for k in keys]
        return [self.clues[k] for k in CLUE_PRESETS[p] if k in self.clues]

    def _build_clues(self):
        sp,pk=self.spec,self.poke; D={}
        genus=next(g['genus'] for g in sp['genera'] if g['language']['name']=='en')
        colour=sp['color']['name'].capitalize()
        D["genus_colour"]=f"• The **{genus}** Pokémon.\n• Main colour: **{colour}**."
        D["types"]="• **"+", ".join(t['type']['name'].capitalize() for t in pk['types'])+"-type**."
        D["height_weight"]=f"• {pk['height']/10:.1f} m, {pk['weight']/10:.1f} kg."
        D["abilities"]="• Abilities: "+", ".join(
            a['ability']['name'].replace('-',' ').capitalize()
            for a in sorted(pk['abilities'],key=lambda x:x['is_hidden']))+"."
        habitat=(sp['habitat']['name'].replace('-',' ').capitalize()
                 if sp['habitat'] else "Unknown")
        gen=sp['generation']['name'].upper().replace("GENERATION ","Gen ")
        D["hab_gen"]=f"• Habitat {habitat}, debut {gen}."
        flav=next(ft for ft in sp['flavor_text_entries'] if ft['language']['name']=='en')
        D["flavour"]="• Pokédex:\n"+wrap(flav['flavor_text'].replace('\n',' '))
        return D

    def dex_page(self):
        pk,sp=self.poke,self.spec
        return (f"{self.name}  (#{self.idx})\n"
                f"Type(s): {', '.join(t['type']['name'].capitalize() for t in pk['types'])}\n"
                f"H: {pk['height']/10:.1f} m   W: {pk['weight']/10:.1f} kg\n"
                f"Abilities: {', '.join(a['ability']['name'].replace('-',' ').capitalize() for a in pk['abilities'])}\n"
                f"Habitat: {(sp['habitat']['name'].replace('-',' ').capitalize() if sp['habitat'] else 'Unknown')}\n"
                f"Gen: {sp['generation']['name'].upper().replace('GENERATION ','Gen ')}\n\n"
                f"{wrap(next(ft for ft in sp['flavor_text_entries'] if ft['language']['name']=='en')['flavor_text'].replace(chr(0x0c),' '))}"
               )

# ─────────────────────────── GUI
class Game(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Who's That Pokémon? – Party Edition")
        self.option_add("*Font", DEFAULT_FONT)

        # config vars
        self.preset   = tk.StringVar(value="Classic")
        self.drink    = tk.StringVar(value="Casual")
        self.timer_on = tk.BooleanVar(value=True)

        # runtime
        self.guess=tk.StringVar(); self.count_lbl=tk.StringVar()
        self.round=None; self.left=self.miss=0; self.timer_id=None; self.over=False

        self._build_conf(); self._build_game(); self._show_conf()

    # config panel
    def _build_conf(self):
        f=self.conf=ttk.Frame(self,padding=20)
        ttk.Label(f,text="Who's That Pokémon?",font=("Helvetica",24,"bold")
                 ).grid(row=0,column=0,columnspan=2,pady=(0,15))

        ttk.Label(f,text="Regions (Ctrl-click to multi-select):"
                 ).grid(row=1,column=0,sticky="w")
        self.reg_lb=tk.Listbox(f,selectmode="extended",exportselection=False,
                               height=len(REGIONS),
                               listvariable=tk.StringVar(value=list(REGIONS)))
        self.reg_lb.selection_set(list(REGIONS).index("National"))
        self.reg_lb.grid(row=1,column=1)

        ttk.Label(f,text="Clue preset:").grid(row=2,column=0,sticky="w",pady=5)
        ttk.Combobox(f,textvariable=self.preset,values=list(CLUE_PRESETS)
                    ).grid(row=2,column=1,pady=5,sticky="w")

        ttk.Label(f,text="Drinking speed:").grid(row=3,column=0,sticky="w",pady=5)
        ttk.Combobox(f,textvariable=self.drink,values=list(DRINK_RULES)
                    ).grid(row=3,column=1,pady=5,sticky="w")

        ttk.Checkbutton(f,text="Enable 10-second timer",variable=self.timer_on
                       ).grid(row=4,column=0,columnspan=2,sticky="w")

        ttk.Button(f,text="Start ▶",command=self.start)\
           .grid(row=5,column=0,columnspan=2,pady=(20,0))

    # game panel
    def _build_game(self):
        g=self.game=ttk.Frame(self,padding=20)
        self.img=ttk.Label(g); self.img.grid(row=0,column=0,columnspan=2)
        ttk.Label(g,textvariable=self.count_lbl,foreground="red"
                 ).grid(row=1,column=0,columnspan=2)
        ttk.Label(g,text="Your guess:").grid(row=2,column=0,sticky="e",pady=10)
        e=ttk.Entry(g,textvariable=self.guess,width=25)
        e.grid(row=2,column=1,sticky="w",pady=10); e.bind("<Return>",lambda _ : self.submit())
        ttk.Button(g,text="Submit",command=self.submit).grid(row=3,column=0,pady=5)
        ttk.Button(g,text="Give Up",command=self.give_up).grid(row=3,column=1,pady=5)
        self.clue=tk.Text(g,width=60,height=6,wrap="word",
                          state="disabled",bg=self.cget("bg"),relief="flat")
        self.clue.grid(row=4,column=0,columnspan=2,pady=(15,0))

    def _show_conf(self): self.game.grid_forget(); self.conf.grid()
    def _show_game(self): self.conf.grid_forget(); self.game.grid()

    # ── round handling
    def start(self):
        sel=[self.reg_lb.get(i) for i in self.reg_lb.curselection()] or ["National"]
        pool=[n for r in sel for n in REGIONS[r]]
        idx=random.choice(pool)

        self.shot=random.random()<SHOT_CHANCE
        self.left=MAX_GUESSES; self.miss=0; self.over=False
        self.guess.set(""); self.count_lbl.set("")
        threading.Thread(target=self._prep,args=(idx,),daemon=True).start()

    def _prep(self,idx):
        try: self.round=Round(idx,self.preset.get())
        except Exception as e:
            messagebox.showerror("Error",e); return
        self.after(0,self._begin)

    def _begin(self):
        self._display(self.round.sil)
        if self.shot: messagebox.showinfo("SHOT ROUND!","5 % roll! Everybody takes a shot 🥃")
        self._set_clue(f"Guess the Pokémon!  ({self.left} guesses)")
        self._show_game()
        if self.timer_on.get(): self._cd_start()

    # helpers
    def _display(self,im,maxsize=(350,350)):
        im=im.copy(); im.thumbnail(maxsize,Image.Resampling.LANCZOS)
        self.tkimg=ImageTk.PhotoImage(im); self.img.configure(image=self.tkimg)

    def _set_clue(self,txt):
        self.clue.config(state="normal"); self.clue.delete("1.0","end")
        self.clue.insert("1.0",txt); self.clue.config(state="disabled")

    # timer
    def _cd_start(self):
        self._cd_cancel(); end=time.time()+COUNTDOWN_SEC
        def tick():
            r=int(end-time.time())
            if r<=0:
                self.count_lbl.set("")
                messagebox.showinfo("⏰ Time!","Drink until somebody types a guess!")
                return
            self.count_lbl.set(f"{r} s to guess…"); self.timer_id=self.after(1000,tick)
        tick()
    def _cd_cancel(self):
        if self.timer_id: self.after_cancel(self.timer_id); self.timer_id=None; self.count_lbl.set("")

    # gameplay
    def submit(self):
        if self.over: return       # round finished
        if not self.round: return
        g=self.guess.get().strip().lower()
        if not g: return
        self.guess.set("")
        if self.timer_on.get(): self._cd_cancel()

        # correct -------------------------------------------------- #
        if g==self.round.name.lower():
            hdr="🎉  Correct!"
            if self.miss==0: hdr+="  Extreme Speed! Everyone else drinks! 🍻"
            extra_casual=(self.drink.get()=="Casual" and self.miss>0)
            if extra_casual: hdr+="\n🍻 "+DRINK_RULES["Casual"]
            self._display(self.round.col)
            self._popup(hdr,self.round.dex_page())
            self.over=True
            return

        # wrong ---------------------------------------------------- #
        if self.left<=0: return   # shouldn't happen, but guard anyway
        self.left-=1; self.miss+=1
        drink_mode=self.drink.get()
        drink_msg=""
        if drink_mode!="Casual":
            drink_msg="🍻 "+DRINK_RULES[drink_mode]+"\n"
        clue=self.round.queue.pop(0) if self.round.queue else "No more clues."
        self._set_clue(f"❌ Nope! {drink_msg}\n{clue}\n\nGuesses left: {self.left}")

        if self.left==0:
            hdr=f"😢  It was {self.round.name}."
            if drink_mode=="Casual": hdr+="\n🍻 "+DRINK_RULES["Casual"]
            self._popup(hdr,self.round.dex_page())
            self.over=True
        elif self.timer_on.get(): self._cd_start()

    # popup
    def _popup(self,header,dex):
        win=tk.Toplevel(self); win.title("Round Result")
        win.transient(self); win.grab_set()
        win.rowconfigure(0,weight=13); win.rowconfigure(1,weight=10)
        win.columnconfigure(0,weight=1)
        tk.Label(win,text=header,font=HEADER_FONT,fg="darkblue",anchor="nw",
                 wraplength=600).grid(row=0,column=0,sticky="nsew",padx=20,pady=(20,5))
        t=tk.Text(win,font=DEX_FONT,wrap="word",height=10)
        t.insert("1.0",dex); t.config(state="disabled")
        t.grid(row=1,column=0,sticky="nsew",padx=20,pady=(5,20))
        fr=ttk.Frame(win); fr.grid(row=2,column=0,pady=(0,20))
        ttk.Button(fr,text="Play again",command=lambda:self._close(win,True)
                  ).grid(row=0,column=0,padx=10)
        ttk.Button(fr,text="Quit",command=lambda:self._close(win,False)
                  ).grid(row=0,column=1,padx=10)

    def _close(self,win,again):
        win.destroy(); (self._show_conf() if again else self.destroy())

    def give_up(self):
        if self.over: return
        if self.timer_on.get(): self._cd_cancel()
        self._display(self.round.col)
        hdr=f"😢  It was {self.round.name}."
        if self.drink.get()=="Casual" and self.miss>0:
            hdr+="\n🍻 "+DRINK_RULES["Casual"]
        self._popup(hdr,self.round.dex_page())
        self.over=True

# ─────────────────────────── run
if __name__=="__main__":
    Game().mainloop()
