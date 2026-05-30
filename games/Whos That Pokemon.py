import io, random, textwrap, threading, time, tkinter as tk
from tkinter import ttk, messagebox
import requests
from PIL import Image, ImageTk

# ───────────── CONSTANTS ───────────── #
API_ROOT = "https://pokeapi.co/api/v2"
ART_URL  = ("https://raw.githubusercontent.com/PokeAPI/sprites/master/"
            "sprites/pokemon/other/official-artwork/{id}.png")

REGIONS = {
    "Kanto 1-151": range(1, 152),
    "Johto 152-251": range(152, 252),
    "Hoenn 251-386": range(252, 387),
    "Sinnoh 387-493": range(387, 494),
    "Unova 494-549": range(494, 650),
    "Kalos 449-721": range(650, 722),
    "Alola 722-809": range(722, 810),
    "Galar 810- 905": range(810, 906),
    "Paldea 906-1025": range(906, 1026),
    "National": range(1, 1026),
}

# --- clue keys you can use: ------------------------------------ #
# "types", "genus_colour", "abilities", "height_weight",
# "hab_gen", "flavour"

CLUE_PRESETS = {
    "Classic":      ["types", "genus_colour", "height_weight",
                     "abilities", "hab_gen", "flavour"],
    "Mystery":      "RANDOM",          # ⇠ handled specially below
    "Stats-First":  ["height_weight", "types", "abilities",
                     "hab_gen", "genus_colour", "flavour"],
    "Lore-First":   ["flavour", "hab_gen", "genus_colour",
                     "types", "abilities", "height_weight"],
    "Colour-First": ["genus_colour", "types", "abilities",
                     "height_weight", "hab_gen", "flavour"],
}

DRINK_RULES = {
    "Lame":       lambda *_: "Drink ur water bud 🫗",
    "Casual":     lambda miss,*_: "Take a sip (miss #2)." if miss == 3 else "",
    "Crushing":   lambda *_: "One sip for that miss!",
    "Blackied":   lambda *_: "Two big gulps, champ! 😵",
    "Real Speed": lambda *_: "Sip for 3 seconds, no pause!",
}

MAX_GUESSES   = 3
COUNTDOWN_SEC = 10          # speed-guess timer length
SHOT_CHANCE   = 0.05        # 5 % of Pokémon are shot rounds

# ───────────── helper functions ───────────── #
def j(url):           return requests.get(url, timeout=15).json()
def species(i):       return j(f"{API_ROOT}/pokemon-species/{i}")
def pokemon(i):       return j(f"{API_ROOT}/pokemon/{i}")
def artwork(i):
    return Image.open(io.BytesIO(
        requests.get(ART_URL.format(id=i), timeout=15).content)
    ).convert("RGBA")

def silhouette(img):
    r,g,b,a = img.split()
    blk = Image.new("RGBA", img.size, (0,0,0,255))
    out = Image.composite(blk, Image.new("RGBA", img.size, (0,0,0,0)), a)
    out.putalpha(a)
    return out

def wrap(txt, width=60): return "\n".join(textwrap.wrap(txt, width))

# ───────────── Round object ───────────── #
class Round:
    def __init__(self, idx: int, preset: str):
        self.idx = idx
        self.spec = species(idx)
        self.poke = pokemon(idx)
        self.name = self.spec["name"].capitalize()
        self.col_img = artwork(idx)
        self.sil_img = silhouette(self.col_img)
        self.clues = self._make_clues()
        self.queue = self._ordered_clues(preset)

    # -------------------------------------------------------------- #
    def _ordered_clues(self, preset: str):
        if preset == "Mystery" or CLUE_PRESETS.get(preset) == "RANDOM":
            keys = list(self.clues.keys())
            random.shuffle(keys)
            return [self.clues[k] for k in keys]
        order = CLUE_PRESETS[preset]
        return [self.clues[k] for k in order if k in self.clues]

    def _make_clues(self):
        sp, pk = self.spec, self.poke
        D = {}
        genus = next(g['genus'] for g in sp['genera'] if g['language']['name'] == 'en')
        colour = sp['color']['name'].capitalize()
        D["genus_colour"] = f"• The **{genus}** Pokémon.\n• Main colour: **{colour}**."

        D["types"] = "• **" + ", ".join(
            t['type']['name'].capitalize() for t in pk['types']
        ) + "-type**."

        D["height_weight"] = f"• {pk['height']/10:.1f} m, {pk['weight']/10:.1f} kg."

        D["abilities"] = "• Abilities: " + ", ".join(
            a['ability']['name'].replace('-', ' ').capitalize()
            for a in sorted(pk['abilities'], key=lambda x: x['is_hidden'])
        ) + "."

        habitat = (sp['habitat']['name'].replace('-', ' ').capitalize()
                   if sp['habitat'] else "Unknown")
        gen = sp['generation']['name'].upper().replace("GENERATION ", "Gen ")
        D["hab_gen"] = f"• Habitat {habitat}, debut {gen}."

        flav = next(ft for ft in sp['flavor_text_entries'] if ft['language']['name'] == 'en')
        D["flavour"] = "• Pokédex:\n" + wrap(flav['flavor_text'].replace('\n', ' '))
        return D

    def dex_page(self):
        pk, sp = self.poke, self.spec
        return (
            f"{self.name}  (#{self.idx})\n"
            f"Type(s): {', '.join(t['type']['name'].capitalize() for t in pk['types'])}\n"
            f"H: {pk['height']/10:.1f} m   W: {pk['weight']/10:.1f} kg\n"
            f"Abilities: {', '.join(a['ability']['name'].replace('-',' ').capitalize() for a in pk['abilities'])}\n"
            f"Habitat: {(sp['habitat']['name'].replace('-',' ').capitalize() if sp['habitat'] else 'Unknown')}\n"
            f"Gen: {sp['generation']['name'].upper().replace('GENERATION ','Gen ')}\n\n"
            f"{wrap(next(ft for ft in sp['flavor_text_entries'] if ft['language']['name']=='en') ['flavor_text'].replace(chr(0x0c),' '))}"
        )

# ───────────── GUI ───────────── #
class Game(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Who's That Pokémon? – Party Edition 3")

        # config-panel variables
        self.region = tk.StringVar(value="National")
        self.preset = tk.StringVar(value="Classic")
        self.drink = tk.StringVar(value="Casual")
        self.timer_on = tk.BooleanVar(value=True)

        # runtime state
        self.guess = tk.StringVar()
        self.count_lbl = tk.StringVar()
        self.round = None
        self.g_left = self.miss = 0
        self.timer_id = None
        self.is_shot = False

        self._build_conf()
        self._build_game()
        self._show_conf()

    # ---------- layout ---------- #
    def _build_conf(self):
        f = self.conf = ttk.Frame(self, padding=20)

        ttk.Label(f, text="Who's That Pokémon?", font=("Helvetica", 18, "bold")
                 ).grid(column=0, row=0, columnspan=2, pady=(0, 15))

        ttk.Label(f, text="Region:").grid(sticky="w")
        ttk.Combobox(f, textvariable=self.region, values=list(REGIONS)
                    ).grid(row=1, column=1, pady=5)

        ttk.Label(f, text="Clue preset:").grid(row=2, column=0, sticky="w")
        ttk.Combobox(f, textvariable=self.preset, values=list(CLUE_PRESETS)
                    ).grid(row=2, column=1, pady=5)

        ttk.Label(f, text="Drinking speed:").grid(row=3, column=0, sticky="w")
        ttk.Combobox(f, textvariable=self.drink, values=list(DRINK_RULES)
                    ).grid(row=3, column=1, pady=5)

        ttk.Checkbutton(
            f, text="Enable 10-second timer", variable=self.timer_on
        ).grid(row=4, column=0, columnspan=2, sticky="w")

        ttk.Button(f, text="Start ▶", command=self.start
                  ).grid(row=5, column=0, columnspan=2, pady=(15, 0))

    def _build_game(self):
        g = self.game = ttk.Frame(self, padding=20)

        self.img_lbl = ttk.Label(g)
        self.img_lbl.grid(row=0, column=0, columnspan=2)

        ttk.Label(g, textvariable=self.count_lbl, foreground="red"
                 ).grid(row=1, column=0, columnspan=2)

        ttk.Label(g, text="Your guess:").grid(row=2, column=0, sticky="e", pady=10)
        entry = ttk.Entry(g, textvariable=self.guess, width=25)
        entry.grid(row=2, column=1, sticky="w", pady=10)
        entry.bind("<Return>", lambda e: self.submit())

        ttk.Button(g, text="Submit", command=self.submit).grid(row=3, column=0, pady=5)
        ttk.Button(g, text="Give Up", command=self.give_up).grid(row=3, column=1, pady=5)

        self.clue_box = tk.Text(g, width=50, height=6, wrap="word",
                                state="disabled", bg=self.cget("bg"), relief="flat")
        self.clue_box.grid(row=4, column=0, columnspan=2, pady=(15, 0))

    # ---------- panel swap ---------- #
    def _show_conf(self): self.game.grid_forget(); self.conf.grid()
    def _show_game(self): self.conf.grid_forget(); self.game.grid()

    # ---------- round setup ---------- #
    def start(self):
        idx = random.choice(list(REGIONS[self.region.get()]))
        self.is_shot = random.random() < SHOT_CHANCE
        self.g_left = MAX_GUESSES
        self.miss = 0
        self.guess.set("")
        self.count_lbl.set("")
        threading.Thread(target=self._prep_round, args=(idx,), daemon=True).start()

    def _prep_round(self, idx):
        try:
            self.round = Round(idx, self.preset.get())
        except Exception as e:
            messagebox.showerror("Error", e)
            return
        self.after(0, self._begin_round)

    def _begin_round(self):
        self._display(self.round.sil_img)
        if self.is_shot:
            messagebox.showinfo("SHOT ROUND!", "5 % hit! Everyone takes a shot 🥃")

        self._set_clue(f"Guess the Pokémon!  ({self.g_left} guesses)")
        self._show_game()
        if self.timer_on.get():
            self._cd_start()

    # ---------- helpers ---------- #
    def _display(self, img, box=(300, 300)):
        i = img.copy()
        i.thumbnail(box, Image.Resampling.LANCZOS)
        self.tk_img = ImageTk.PhotoImage(i)
        self.img_lbl.configure(image=self.tk_img)

    def _set_clue(self, txt):
        self.clue_box.config(state="normal")
        self.clue_box.delete("1.0", "end")
        self.clue_box.insert("1.0", txt)
        self.clue_box.config(state="disabled")

    # ---------- countdown ---------- #
    def _cd_start(self):
        self._cd_cancel()
        end = time.time() + COUNTDOWN_SEC

        def tick():
            remain = int(end - time.time())
            if remain <= 0:
                self.count_lbl.set("")
                messagebox.showinfo(
                    "⏰ Time!", "Drink until somebody types a guess!"
                )
                return
            self.count_lbl.set(f"{remain} s to guess…")
            self.timer_id = self.after(1000, tick)

        tick()

    def _cd_cancel(self):
        if self.timer_id:
            self.after_cancel(self.timer_id)
            self.timer_id = None
            self.count_lbl.set("")

    # ---------- gameplay ---------- #
    def submit(self):
        if not self.round:
            return
        g = self.guess.get().strip().lower()
        if not g:
            return
        self.guess.set("")
        if self.timer_on.get():
            self._cd_cancel()

        # ----- correct -----
        if g == self.round.name.lower():
            first_try = self.miss == 0
            self._display(self.round.col_img)
            msg = "🎉 Correct!"
            if first_try:
                msg += "\nExtreme Speed! Everyone else drinks! 🍻"
            msg += "\n\n" + self.round.dex_page()
            again = messagebox.askyesno("Win", msg + "\nPlay again?")
            self._show_conf() if again else self.destroy()
            return

        # ----- wrong -----
        self.g_left -= 1
        self.miss += 1

        drink_msg = DRINK_RULES[self.drink.get()](self.miss, self.g_left)
        if drink_msg:
            drink_msg = "🍻 " + drink_msg + "\n"

        if self.round.queue:
            clue = self.round.queue.pop(0)
            self._set_clue(
                f"❌ Nope! {drink_msg}\n{clue}\n\nGuesses left: {self.g_left}"
            )
        else:
            self._set_clue(
                f"❌ Nope! {drink_msg}\nNo more clues.\nGuesses left: {self.g_left}"
            )

        if self.g_left == 0:
            self.give_up()
        else:
            if self.timer_on.get():
                self._cd_start()

    def give_up(self):
        if self.timer_on.get():
            self._cd_cancel()
        self._display(self.round.col_img)
        again = messagebox.askyesno(
            "Reveal",
            f"😢 It was {self.round.name}.\n\n{self.round.dex_page()}\nPlay again?",
        )
        self._show_conf() if again else self.destroy()

# ───────────── main ───────────── #
if __name__ == "__main__":
    Game().mainloop()
