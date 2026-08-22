"use client";

/* Compact emoji popover shared by the DM dock and the community
   composers. No dependency — a curated static list with short keyword
   names for search, plus a "Recent" row persisted in localStorage.

   Positioning is the caller's job: render inside a `position: relative`
   wrapper; the popover anchors itself with `position: absolute`. */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import useEscapeClose from "@/lib/useEscapeClose";

const RECENT_KEY = "agora:emoji-recent";
const RECENT_MAX = 24;

/* "emoji keyword keyword…" — the first token is the emoji itself. */
const CATEGORIES: { name: string; items: string }[] = [
  {
    name: "Smileys",
    items: `😀 grin happy|😃 smile happy|😄 smile laugh|😁 beam grin|😆 laugh squint|😅 sweat laugh|🤣 rofl laughing|😂 joy tears laugh|🙂 slight smile|🙃 upside down|😉 wink|😊 blush smile|😇 halo angel|🥰 hearts love|😍 heart eyes love|🤩 star struck|😘 kiss blow|😗 kiss|😚 kiss closed|😙 kiss smile|🥲 tear smile|😋 yum tongue|😛 tongue|😜 wink tongue|🤪 zany crazy|😝 squint tongue|🤑 money|🤗 hug|🤭 hand mouth|🤫 shush quiet|🤔 think hmm|🫡 salute|🤐 zipper mouth|🤨 raised eyebrow|😐 neutral|😑 expressionless|😶 no mouth|😏 smirk|😒 unamused|🙄 eye roll|😬 grimace|🤥 lying|😌 relieved|😔 pensive sad|😪 sleepy|🤤 drool|😴 sleeping zzz|😷 mask sick|🤒 thermometer sick|🤕 bandage hurt|🤢 nauseated|🤮 vomit|🤧 sneeze|🥵 hot|🥶 cold freezing|🥴 woozy|😵 dizzy|🤯 mind blown|🤠 cowboy|🥳 party celebrate|🥸 disguise|😎 sunglasses cool|🤓 nerd|🧐 monocle|😕 confused|🫤 diagonal mouth|😟 worried|🙁 frown|☹️ frowning|😮 open mouth|😯 hushed|😲 astonished|😳 flushed|🥺 pleading puppy|🥹 holding tears|😦 frowning open|😧 anguished|😨 fearful|😰 anxious sweat|😥 sad relieved|😢 cry tear|😭 sob cry|😱 scream|😖 confounded|😣 persevere|😞 disappointed|😓 downcast sweat|😩 weary|😫 tired|🥱 yawn|😤 triumph steam|😡 angry rage|😠 angry|🤬 cursing swear|😈 devil smile|👿 imp angry|💀 skull dead|☠️ skull crossbones|💩 poop|🤡 clown|👹 ogre|👺 goblin|👻 ghost|👽 alien|🤖 robot|😺 cat smile|😸 cat grin|😹 cat joy|😻 cat heart eyes|😼 cat smirk|😽 cat kiss|🙀 cat weary|😿 cat cry|😾 cat pouting`,
  },
  {
    name: "People",
    items: `👋 wave hello|🤚 raised back hand|🖐️ hand fingers|✋ raised hand stop|🖖 vulcan|👌 ok|🤌 pinched fingers|🤏 pinch|✌️ peace victory|🤞 crossed fingers luck|🫰 hand heart|🤟 love you|🤘 rock horns|🤙 call me|👈 point left|👉 point right|👆 point up|🖕 middle finger|👇 point down|☝️ index up|👍 thumbs up like|👎 thumbs down dislike|✊ fist|👊 punch|🤛 left fist|🤜 right fist|👏 clap applause|🙌 raised hands hooray|🫶 heart hands|👐 open hands|🤲 palms up|🤝 handshake deal|🙏 pray please thanks|✍️ writing|💅 nail polish|🤳 selfie|💪 muscle strong flex|🦾 mechanical arm|🦵 leg|🦶 foot|👂 ear|👃 nose|🧠 brain|🫀 heart organ|🦷 tooth|👀 eyes look|👁️ eye|👅 tongue|👄 lips mouth|👶 baby|🧒 child|👦 boy|👧 girl|🧑 person adult|👱 blond|👨 man|🧔 beard|👩 woman|🧓 older person|👴 old man|👵 old woman|🙍 frowning person|🙎 pouting person|🙅 no gesture|🙆 ok gesture|💁 tipping hand|🙋 raising hand|🧏 deaf|🙇 bow|🤦 facepalm|🤷 shrug|👮 police|🕵️ detective|💂 guard|🥷 ninja|👷 construction worker|🤴 prince|👸 princess|👳 turban|🧕 headscarf|🤵 tuxedo|👰 veil bride|🤰 pregnant|🤱 breastfeeding|👼 angel baby|🎅 santa|🤶 mrs claus|🦸 superhero|🦹 supervillain|🧙 mage wizard|🧚 fairy|🧛 vampire|🧜 mermaid|🧝 elf|🧞 genie|🧟 zombie|💆 massage|💇 haircut|🚶 walking|🏃 running|💃 dancer|🕺 dancing man|🕴️ levitate suit|👯 bunny ears|🧘 yoga meditate|🛀 bath|🛌 bed sleep|👫 couple|👬 two men|👭 two women|💏 kiss couple|💑 couple heart|👪 family|🗣️ speaking head|👤 silhouette|👥 busts|🫂 hug people`,
  },
  {
    name: "Animals",
    items: `🐶 dog puppy|🐱 cat kitten|🐭 mouse|🐹 hamster|🐰 rabbit bunny|🦊 fox|🐻 bear|🐼 panda|🐻‍❄️ polar bear|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey face|🙈 see no evil|🙉 hear no evil|🙊 speak no evil|🐒 monkey|🐔 chicken|🐧 penguin|🐦 bird|🐤 chick|🦆 duck|🦅 eagle|🦉 owl|🦇 bat|🐺 wolf|🐗 boar|🐴 horse|🦄 unicorn|🐝 bee|🐛 bug caterpillar|🦋 butterfly|🐌 snail|🐞 ladybug|🐜 ant|🦟 mosquito|🪳 cockroach|🕷️ spider|🦂 scorpion|🐢 turtle|🐍 snake|🦎 lizard|🦖 t-rex dinosaur|🦕 dinosaur|🐙 octopus|🦑 squid|🦐 shrimp|🦞 lobster|🦀 crab|🐡 blowfish|🐠 tropical fish|🐟 fish|🐬 dolphin|🐳 whale|🦈 shark|🐊 crocodile|🐅 tiger|🐆 leopard|🦓 zebra|🦍 gorilla|🦧 orangutan|🐘 elephant|🦛 hippo|🦏 rhino|🐪 camel|🦒 giraffe|🦘 kangaroo|🐃 buffalo|🐂 ox|🐄 cow|🐎 horse racing|🐖 pig|🐏 ram|🐑 sheep|🦙 llama|🐐 goat|🦌 deer|🐕 dog|🐩 poodle|🦮 guide dog|🐈 cat|🐈‍⬛ black cat|🐓 rooster|🦃 turkey|🦚 peacock|🦜 parrot|🦢 swan|🦩 flamingo|🕊️ dove peace|🐇 rabbit|🦝 raccoon|🦨 skunk|🦡 badger|🦫 beaver|🦦 otter|🦥 sloth|🐁 mouse|🐀 rat|🐿️ chipmunk squirrel|🦔 hedgehog|🐾 paw prints|🐉 dragon|🐲 dragon face|🌵 cactus|🎄 christmas tree|🌲 evergreen|🌳 tree|🌴 palm|🪵 wood|🌱 seedling|🌿 herb|☘️ shamrock|🍀 four leaf clover luck|🎍 bamboo|🍃 leaf wind|🍂 fallen leaf|🍁 maple leaf|🍄 mushroom|🐚 shell|🌾 rice|💐 bouquet|🌷 tulip|🌹 rose|🥀 wilted|🌺 hibiscus|🌸 cherry blossom|🌼 blossom|🌻 sunflower|🌞 sun face|🌝 full moon face|🌛 moon face|🌜 last quarter moon|🌚 new moon face|🌕 full moon|🌙 crescent moon|⭐ star|🌟 glowing star|✨ sparkles|⚡ lightning zap|☄️ comet|💥 boom explosion|🔥 fire lit|🌪️ tornado|🌈 rainbow|☀️ sun sunny|🌤️ sun cloud|⛅ partly cloudy|☁️ cloud|🌧️ rain|⛈️ thunder|🌩️ lightning cloud|❄️ snowflake|☃️ snowman|⛄ snowman|🌬️ wind|💨 dash wind|💧 droplet|💦 sweat drops|🌊 wave ocean|🌍 earth globe|🌎 americas globe|🌏 asia globe|🪐 planet saturn|🌌 milky way`,
  },
  {
    name: "Food",
    items: `🍏 green apple|🍎 apple|🍐 pear|🍊 orange tangerine|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🫐 blueberries|🍈 melon|🍒 cherries|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥝 kiwi|🍅 tomato|🍆 eggplant|🥑 avocado|🥦 broccoli|🥬 leafy green|🥒 cucumber|🌶️ hot pepper|🫑 bell pepper|🌽 corn|🥕 carrot|🧄 garlic|🧅 onion|🥔 potato|🍠 sweet potato|🥐 croissant|🥯 bagel|🍞 bread|🥖 baguette|🥨 pretzel|🧀 cheese|🥚 egg|🍳 cooking fried egg|🧈 butter|🥞 pancakes|🧇 waffle|🥓 bacon|🥩 steak|🍗 poultry leg|🍖 meat bone|🌭 hot dog|🍔 burger|🍟 fries|🍕 pizza|🫓 flatbread|🥪 sandwich|🥙 stuffed flatbread|🧆 falafel|🌮 taco|🌯 burrito|🫔 tamale|🥗 salad|🥘 paella|🫕 fondue|🍝 spaghetti pasta|🍜 ramen noodles|🍲 stew|🍛 curry|🍣 sushi|🍱 bento|🥟 dumpling|🦪 oyster|🍤 fried shrimp|🍙 rice ball|🍚 rice|🍘 rice cracker|🍥 fish cake|🥠 fortune cookie|🥮 moon cake|🍢 oden|🍡 dango|🍧 shaved ice|🍨 ice cream|🍦 soft serve|🥧 pie|🧁 cupcake|🍰 cake slice|🎂 birthday cake|🍮 custard|🍭 lollipop|🍬 candy|🍫 chocolate|🍿 popcorn|🍩 donut|🍪 cookie|🌰 chestnut|🥜 peanuts|🍯 honey|🥛 milk|🍼 baby bottle|☕ coffee|🫖 teapot|🍵 tea|🧃 juice box|🥤 cup straw soda|🧋 bubble tea|🍶 sake|🍺 beer|🍻 beers cheers|🥂 champagne cheers|🍷 wine|🥃 whiskey|🍸 cocktail|🍹 tropical drink|🧉 mate|🍾 champagne bottle|🧊 ice cube|🥄 spoon|🍴 fork knife|🍽️ plate|🥣 bowl|🥡 takeout|🧂 salt`,
  },
  {
    name: "Activities",
    items: `⚽ soccer football|🏀 basketball|🏈 american football|⚾ baseball|🥎 softball|🎾 tennis|🏐 volleyball|🏉 rugby|🥏 frisbee|🎱 pool billiards|🪀 yoyo|🏓 ping pong|🏸 badminton|🏒 hockey|🏑 field hockey|🥍 lacrosse|🏏 cricket|🪃 boomerang|🥅 goal|⛳ golf|🪁 kite|🏹 archery bow|🎣 fishing|🤿 diving|🥊 boxing|🥋 martial arts|🎽 running shirt|🛹 skateboard|🛼 roller skate|🛷 sled|⛸️ ice skate|🥌 curling|🎿 ski|⛷️ skier|🏂 snowboard|🪂 parachute|🏋️ weightlifting gym|🤼 wrestling|🤸 cartwheel gymnastics|⛹️ bouncing ball|🤺 fencing|🤾 handball|🏌️ golfing|🏇 horse racing|🧘 yoga|🏄 surfing|🏊 swimming|🤽 water polo|🚣 rowing|🧗 climbing|🚵 mountain biking|🚴 cycling bike|🏆 trophy winner|🥇 gold medal first|🥈 silver medal|🥉 bronze medal|🏅 medal|🎖️ military medal|🏵️ rosette|🎗️ ribbon|🎫 ticket|🎟️ admission ticket|🎪 circus|🤹 juggling|🎭 theater drama|🩰 ballet|🎨 art palette paint|🎬 clapper movie|🎤 microphone sing|🎧 headphones music|🎼 music score|🎹 piano|🥁 drum|🪘 long drum|🎷 saxophone|🎺 trumpet|🪗 accordion|🎸 guitar|🪕 banjo|🎻 violin|🎲 dice game|♟️ chess|🎯 bullseye target|🎳 bowling|🎮 video game controller|🕹️ joystick|🎰 slot machine|🧩 puzzle piece|🎉 party popper tada|🎊 confetti|🎈 balloon|🎁 gift present|🎀 ribbon bow|🪄 magic wand|🎃 jack o lantern halloween|🎆 fireworks|🎇 sparkler|🧨 firecracker`,
  },
  {
    name: "Travel",
    items: `🚗 car|🚕 taxi|🚙 suv|🚌 bus|🚎 trolleybus|🏎️ race car|🚓 police car|🚑 ambulance|🚒 fire engine|🚐 minibus|🛻 pickup truck|🚚 truck delivery|🚛 lorry|🚜 tractor|🦯 cane|🦽 wheelchair|🛴 scooter|🚲 bicycle|🛵 moped|🏍️ motorcycle|🛺 rickshaw|🚨 siren alert|🚔 police|🚍 bus|🚘 car front|🚖 taxi front|🚡 aerial tram|🚠 gondola|🚟 suspension railway|🚃 railway car|🚋 tram|🚞 mountain railway|🚝 monorail|🚄 bullet train|🚅 train|🚈 light rail|🚂 locomotive|🚆 train|🚇 metro subway|🚊 tram|🚉 station|✈️ airplane flight|🛫 departure|🛬 arrival|🛩️ small plane|💺 seat|🛰️ satellite|🚀 rocket launch|🛸 ufo flying saucer|🚁 helicopter|🛶 canoe|⛵ sailboat|🚤 speedboat|🛥️ motor boat|🛳️ cruise ship|⛴️ ferry|🚢 ship|⚓ anchor|🪝 hook|⛽ fuel gas|🚧 construction|🚦 traffic light|🚥 horizontal light|🛑 stop sign|🗺️ world map|🗿 moai statue|🗽 statue of liberty|🗼 tokyo tower|🏰 castle|🏯 japanese castle|🏟️ stadium|🎡 ferris wheel|🎢 roller coaster|🎠 carousel|⛲ fountain|⛱️ beach umbrella|🏖️ beach|🏝️ island|🏜️ desert|🌋 volcano|⛰️ mountain|🏔️ snow mountain|🗻 mount fuji|🏕️ camping|⛺ tent|🏠 house home|🏡 house garden|🏘️ houses|🏚️ derelict house|🏗️ construction site|🏭 factory|🏢 office building|🏬 department store|🏣 post office|🏤 european post|🏥 hospital|🏦 bank|🏨 hotel|🏪 convenience store|🏫 school|🏩 love hotel|💒 wedding|🏛️ classical building|⛪ church|🕌 mosque|🕍 synagogue|🛕 hindu temple|🕋 kaaba|⛩️ shinto shrine|🛤️ railway track|🛣️ motorway|🗾 japan map|🎑 moon viewing|🏞️ national park|🌅 sunrise|🌄 sunrise mountains|🌠 shooting star|🎇 sparkler|🌇 sunset|🌆 cityscape dusk|🏙️ cityscape|🌃 night stars|🌌 milky way|🌉 bridge night|🌁 foggy`,
  },
  {
    name: "Objects",
    items: `⌚ watch|📱 phone mobile|💻 laptop|⌨️ keyboard|🖥️ desktop computer|🖨️ printer|🖱️ mouse computer|💽 minidisc|💾 floppy save|💿 cd|📀 dvd|📷 camera|📸 camera flash|📹 video camera|🎥 movie camera|📽️ projector|🎞️ film|📞 telephone|☎️ phone|📟 pager|📠 fax|📺 tv television|📻 radio|🎙️ studio microphone|🎚️ level slider|🎛️ control knobs|🧭 compass|⏱️ stopwatch|⏲️ timer|⏰ alarm clock|🕰️ mantel clock|⌛ hourglass done|⏳ hourglass|📡 satellite antenna|🔋 battery|🔌 plug|💡 light bulb idea|🔦 flashlight|🕯️ candle|🧯 fire extinguisher|🛢️ oil drum|💸 money wings|💵 dollar|💴 yen|💶 euro|💷 pound|🪙 coin|💰 money bag|💳 credit card|💎 gem diamond|⚖️ scale balance justice|🪜 ladder|🧰 toolbox|🪛 screwdriver|🔧 wrench|🔨 hammer|⚒️ hammer pick|🛠️ tools|⛏️ pick|🪚 saw|🔩 nut bolt|⚙️ gear|🧱 brick|⛓️ chains|🧲 magnet|🔫 pistol|💣 bomb|🧨 dynamite|🪓 axe|🔪 knife|🗡️ dagger|⚔️ crossed swords|🛡️ shield|🚬 cigarette|⚰️ coffin|🪦 headstone|⚱️ urn|🏺 amphora|🔮 crystal ball|📿 prayer beads|🧿 nazar amulet|💈 barber pole|⚗️ alembic|🔭 telescope|🔬 microscope|🕳️ hole|🩹 bandage|🩺 stethoscope|💊 pill|💉 syringe|🩸 blood drop|🧬 dna|🦠 microbe virus|🧫 petri dish|🧪 test tube|🌡️ thermometer|🧹 broom|🪠 plunger|🧺 basket|🧻 toilet paper|🚽 toilet|🚰 potable water|🚿 shower|🛁 bathtub|🛀 bath|🧼 soap|🪥 toothbrush|🪒 razor|🧽 sponge|🪣 bucket|🧴 lotion|🛎️ bellhop bell|🔑 key|🗝️ old key|🚪 door|🪑 chair|🛋️ couch|🛏️ bed|🧸 teddy bear|🪆 nesting dolls|🖼️ framed picture|🪞 mirror|🪟 window|🛍️ shopping bags|🛒 shopping cart|🎁 gift|🎈 balloon|🎏 carp streamer|🎐 wind chime|🧧 red envelope|✉️ envelope email|📩 envelope arrow|📨 incoming envelope|📧 email|💌 love letter|📮 postbox|📪 mailbox|📦 package box|🏷️ label tag|📜 scroll|📃 page curl|📄 page document|📑 bookmark tabs|🧾 receipt|📊 bar chart|📈 chart up|📉 chart down|🗒️ notepad|🗓️ calendar|📆 calendar tear|📅 calendar|📇 card index|🗃️ card box|🗳️ ballot box vote|🗄️ file cabinet|📋 clipboard|📁 folder|📂 open folder|🗂️ dividers|🗞️ newspaper|📰 news|📓 notebook|📔 notebook decor|📒 ledger|📕 red book|📗 green book|📘 blue book|📙 orange book|📚 books|📖 open book|🔖 bookmark|🧷 safety pin|🔗 link|📎 paperclip|🖇️ paperclips|📐 triangular ruler|📏 ruler|🧮 abacus|📌 pushpin|📍 round pushpin location|✂️ scissors|🖊️ pen|🖋️ fountain pen|✒️ nib|🖌️ paintbrush|🖍️ crayon|📝 memo pencil|✏️ pencil|🔍 magnifier search|🔎 magnifier right|🔏 locked pen|🔐 locked key|🔒 locked|🔓 unlocked|🎓 graduation cap|👑 crown|🎩 top hat|🧢 cap|⛑️ rescue helmet|📿 beads|💄 lipstick|💍 ring|👓 glasses|🕶️ sunglasses|🥽 goggles|🧥 coat|👔 necktie|👕 t-shirt|👖 jeans|🧣 scarf|🧤 gloves|🧦 socks|👗 dress|👘 kimono|🥻 sari|👙 bikini|👚 womans clothes|👛 purse|👜 handbag|👝 pouch|🎒 backpack|👞 shoe|👟 sneaker|🥾 hiking boot|🥿 flat shoe|👠 high heel|👡 sandal|🩰 ballet shoes|👢 boot|🧳 luggage|☂️ umbrella|🌂 closed umbrella`,
  },
  {
    name: "Symbols",
    items: `❤️ red heart love|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🖤 black heart|🤍 white heart|🤎 brown heart|💔 broken heart|❣️ heart exclamation|💕 two hearts|💞 revolving hearts|💓 beating heart|💗 growing heart|💖 sparkling heart|💘 heart arrow|💝 heart ribbon|💟 heart decoration|☮️ peace|✝️ cross|☪️ star crescent|🕉️ om|☸️ dharma|✡️ star of david|🔯 six pointed star|🕎 menorah|☯️ yin yang|☦️ orthodox cross|🛐 place of worship|⛎ ophiuchus|♈ aries|♉ taurus|♊ gemini|♋ cancer|♌ leo|♍ virgo|♎ libra|♏ scorpio|♐ sagittarius|♑ capricorn|♒ aquarius|♓ pisces|🆔 id|⚛️ atom|🉑 accept|☢️ radioactive|☣️ biohazard|📴 mobile off|📳 vibration|🈶 not free|🈚 free|🈸 application|🈺 open|🈷️ monthly|✴️ eight pointed star|🆚 vs versus|💮 white flower|🉐 bargain|㊙️ secret|㊗️ congratulations|🈴 passing|🈵 no vacancy|🈹 discount|🈲 prohibited|🅰️ a blood|🅱️ b blood|🆎 ab blood|🆑 cl|🅾️ o blood|🆘 sos help|❌ cross mark no wrong|⭕ hollow circle|🛑 stop|⛔ no entry|📛 name badge|🚫 prohibited|💯 hundred perfect|💢 anger|♨️ hot springs|🚷 no pedestrians|🚯 no littering|🚳 no bicycles|🚱 non potable|🔞 18 adult|📵 no phones|❗ exclamation|❕ white exclamation|❓ question|❔ white question|‼️ double exclamation|⁉️ exclamation question|🔅 dim|🔆 bright|〽️ part alternation|⚠️ warning|🚸 children crossing|🔱 trident|⚜️ fleur de lis|🔰 beginner|♻️ recycle|✅ check mark done yes|🈯 reserved|💹 chart yen|❇️ sparkle|✳️ eight spoked|❎ cross mark button|🌐 globe meridians|💠 diamond dot|Ⓜ️ circled m|🌀 cyclone|💤 zzz sleep|🏧 atm|🚾 wc|♿ wheelchair|🅿️ parking|🛗 elevator|🈳 vacancy|🈂️ service|🛂 passport|🛃 customs|🛄 baggage|🛅 left luggage|🚹 mens|🚺 womens|🚼 baby symbol|⚧️ transgender|🚻 restroom|🚮 litter|🎦 cinema|📶 signal bars|🈁 here|🔣 symbols|ℹ️ information|🔤 abc|🔡 abcd lower|🔠 abcd upper|🆖 ng|🆗 ok|🆙 up|🆒 cool|🆕 new|🆓 free|0️⃣ zero|1️⃣ one|2️⃣ two|3️⃣ three|4️⃣ four|5️⃣ five|6️⃣ six|7️⃣ seven|8️⃣ eight|9️⃣ nine|🔟 ten|🔢 numbers 1234|#️⃣ hash|*️⃣ asterisk|⏏️ eject|▶️ play|⏸️ pause|⏯️ play pause|⏹️ stop|⏺️ record|⏭️ next track|⏮️ previous track|⏩ fast forward|⏪ rewind|⏫ fast up|⏬ fast down|◀️ reverse|🔼 up button|🔽 down button|➡️ right arrow|⬅️ left arrow|⬆️ up arrow|⬇️ down arrow|↗️ up right|↘️ down right|↙️ down left|↖️ up left|↕️ up down|↔️ left right|↪️ right hook|↩️ left hook|⤴️ curve up|⤵️ curve down|🔀 shuffle|🔁 repeat|🔂 repeat one|🔄 refresh arrows|🔃 clockwise|🎵 music note|🎶 music notes|➕ plus|➖ minus|➗ divide|✖️ multiply|♾️ infinity|💲 dollar sign|💱 currency exchange|™️ trademark|©️ copyright|®️ registered|〰️ wavy dash|➰ curly loop|➿ double loop|🔚 end|🔙 back|🔛 on|🔝 top|🔜 soon|✔️ check|☑️ check box|🔘 radio button|🔴 red circle|🟠 orange circle|🟡 yellow circle|🟢 green circle|🔵 blue circle|🟣 purple circle|⚫ black circle|⚪ white circle|🟤 brown circle|🔺 red triangle up|🔻 red triangle down|🔸 small orange diamond|🔹 small blue diamond|🔶 orange diamond|🔷 blue diamond|🔳 white square button|🔲 black square button|▪️ black small square|▫️ white small square|◾ black medium small|◽ white medium small|◼️ black medium|◻️ white medium|🟥 red square|🟧 orange square|🟨 yellow square|🟩 green square|🟦 blue square|🟪 purple square|⬛ black square|⬜ white square|🟫 brown square|🔈 speaker|🔇 muted|🔉 speaker low|🔊 speaker loud|🔔 bell|🔕 bell off|📣 megaphone|📢 loudspeaker|👁️‍🗨️ eye bubble|💬 speech bubble|💭 thought bubble|🗯️ anger bubble|♠️ spades|♣️ clubs|♥️ hearts|♦️ diamonds|🃏 joker|🎴 flower cards|🀄 mahjong|🕐 one oclock|🕑 two|🕒 three|🕓 four|🕔 five|🕕 six|🕖 seven|🕗 eight|🕘 nine|🕙 ten|🕚 eleven|🕛 twelve`,
  },
  {
    name: "Flags",
    items: `🏳️ white flag|🏴 black flag|🏁 checkered finish|🚩 triangular red flag|🏳️‍🌈 rainbow pride|🏳️‍⚧️ transgender flag|🏴‍☠️ pirate|🇺🇸 usa united states america|🇬🇧 uk britain|🇨🇦 canada|🇲🇽 mexico|🇧🇷 brazil|🇦🇷 argentina|🇫🇷 france|🇩🇪 germany|🇮🇹 italy|🇪🇸 spain|🇵🇹 portugal|🇳🇱 netherlands|🇧🇪 belgium|🇨🇭 switzerland|🇦🇹 austria|🇸🇪 sweden|🇳🇴 norway|🇩🇰 denmark|🇫🇮 finland|🇮🇪 ireland|🇵🇱 poland|🇺🇦 ukraine|🇷🇺 russia|🇹🇷 turkey|🇬🇷 greece|🇮🇱 israel|🇸🇦 saudi arabia|🇦🇪 uae emirates|🇪🇬 egypt|🇿🇦 south africa|🇳🇬 nigeria|🇰🇪 kenya|🇮🇳 india|🇵🇰 pakistan|🇨🇳 china|🇯🇵 japan|🇰🇷 korea|🇵🇭 philippines|🇮🇩 indonesia|🇻🇳 vietnam|🇹🇭 thailand|🇸🇬 singapore|🇦🇺 australia|🇳🇿 new zealand|🇪🇺 european union|🇺🇳 united nations`,
  },
];

type Entry = { e: string; k: string };

const ALL: { name: string; entries: Entry[] }[] = CATEGORIES.map((c) => ({
  name: c.name,
  entries: c.items.split("|").map((s) => {
    const i = s.indexOf(" ");
    return { e: s.slice(0, i), k: s.slice(i + 1).toLowerCase() };
  }),
}));

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushRecent(e: string) {
  try {
    const next = [e, ...readRecent().filter((x) => x !== e)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recent row is best-effort */
  }
}

export default function EmojiPicker({
  onPick,
  onClose,
  align = "left",
  vertical = "below",
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** Which edge of the wrapper to anchor to. */
  align?: "left" | "right";
  /** Open below (default) or above the wrapper. */
  vertical?: "below" | "above";
}) {
  const [query, setQuery] = useState("");
  /* Lazy init is safe: the picker only ever mounts client-side on click. */
  const [recent, setRecent] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecent()));
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEscapeClose(true, onClose);

  /* Click-away closes. */
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const out: Entry[] = [];
    for (const c of ALL) for (const en of c.entries) if (en.k.includes(q)) out.push(en);
    return out.slice(0, 120);
  }, [q]);

  const pick = (e: string) => {
    pushRecent(e);
    setRecent(readRecent());
    onPick(e);
  };

  const cell = (e: string, key: string) => (
    <button
      key={key}
      type="button"
      onClick={() => pick(e)}
      title={e}
      style={{
        width: 30,
        height: 30,
        fontSize: 19,
        lineHeight: "30px",
        background: "none",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        padding: 0,
        textAlign: "center",
      }}
      onMouseEnter={(ev) => ((ev.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.1)")}
      onMouseLeave={(ev) => ((ev.currentTarget as HTMLElement).style.background = "none")}
    >
      {e}
    </button>
  );

  const heading = (t: string) => (
    <p
      key={`h-${t}`}
      style={{
        margin: "6px 4px 2px",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "rgba(238,238,245,0.4)",
      }}
    >
      {t}
    </p>
  );

  const grid: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 1 };

  return (
    <div
      ref={boxRef}
      style={{
        position: "absolute",
        [align === "left" ? "left" : "right"]: 0,
        [vertical === "below" ? "top" : "bottom"]: "100%",
        [vertical === "below" ? "marginTop" : "marginBottom"]: 6,
        zIndex: 40,
        width: 280,
        height: 300,
        display: "flex",
        flexDirection: "column",
        background: "rgba(10,12,18,0.97)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12,
        boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
        overflow: "hidden",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div style={{ padding: 8, display: "flex", alignItems: "center", gap: 6, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <Icon name="search" size={13} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = results?.[0]?.e;
              if (first) pick(first);
            }
          }}
          placeholder="Search emoji…"
          style={{
            flex: 1,
            minWidth: 0,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "#eeeef5",
            fontSize: 12.5,
            padding: "5px 9px",
            outline: "none",
            fontFamily: "inherit",
          }}
        />
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "2px 6px 8px" }}>
        {results ? (
          results.length ? (
            <div style={grid}>{results.map((en, i) => cell(en.e, `${en.e}-${i}`))}</div>
          ) : (
            <p style={{ margin: 0, padding: "24px 0", textAlign: "center", fontSize: 11.5, color: "rgba(238,238,245,0.35)" }}>
              No matches.
            </p>
          )
        ) : (
          <>
            {recent.length > 0 && (
              <>
                {heading("Recent")}
                <div style={grid}>{recent.map((e, i) => cell(e, `r-${i}`))}</div>
              </>
            )}
            {ALL.map((c) => (
              <div key={c.name}>
                {heading(c.name)}
                <div style={grid}>{c.entries.map((en, i) => cell(en.e, `${c.name}-${i}`))}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
