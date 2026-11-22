package com.exsub.data;

import com.exsub.data.CatalogLoader.RawExercise;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Generates the synthetic-but-realistic exercise catalog.
 *
 * <p>~100 hand-written base movements are expanded over their equipment variants
 * (e.g. "Bench Press" → Barbell / Dumbbell / Smith Machine Bench Press) and a few tempo/paused
 * variants, producing ~300 entries. Tags drive the injury rules; a tag written {@code tag@a+b}
 * only applies to the listed equipment (e.g. axial loading only for the barbell variant).
 *
 * <p>{@link #scaled(int, long)} produces arbitrarily large catalogs for benchmarks by
 * combining base entries with random modifiers.
 */
public final class ExerciseCatalogGenerator {

    private ExerciseCatalogGenerator() { }

    // name | pattern | primary | secondary | equipment | tags | cue
    private static final String[] BASES = {
        // ---------- PUSH ----------
        "Bench Press|push|chest|triceps,front-delts|barbell,dumbbell,smith-machine|horizontal-press|Lower the weight to mid-chest and press up in a slight arc.",
        "Incline Bench Press|push|chest,front-delts|triceps|barbell,dumbbell,smith-machine|incline-press|Set the bench to about thirty degrees and press over the upper chest.",
        "Decline Bench Press|push|chest|triceps|barbell,dumbbell|horizontal-press|Hook your feet securely and lower the weight to the lower chest.",
        "Floor Press|push|chest,triceps|front-delts|barbell,dumbbell,kettlebell|reduced-range,shoulder-friendly|Lie on the floor and pause when your upper arms touch the ground.",
        "Chest Press|push|chest|triceps,front-delts|machine,cable,resistance-band|supported,shoulder-friendly|Keep your back against the pad and press the handles forward.",
        "Push-Up|push|chest|triceps,front-delts,core|bodyweight|wrist-weight-bearing,wrist-extension-load|Stack your wrists under your shoulders and lower your chest to the floor.",
        "Incline Push-Up|push|chest|triceps,front-delts|bodyweight|wrist-weight-bearing,wrist-extension-load,low-load|Place your hands on a raised surface to reduce the load.",
        "Neutral-Grip Push-Up|push|chest|triceps,front-delts|push-up-handles|neutral-wrist|Grip the handles so your wrists stay straight and neutral.",
        "Dip|push|chest,triceps|front-delts|parallel-bars,assisted-machine|end-range-shoulder-extension|Lean slightly forward and lower until the shoulders are just below the elbows.",
        "Overhead Press|push|front-delts|triceps,upper-chest,core|barbell,dumbbell,kettlebell|overhead,axial-loading@barbell|Press overhead until the arms are locked out beside the ears.",
        "Seated Overhead Press|push|front-delts|triceps|dumbbell,machine|overhead,supported|Sit tall against the backrest and press overhead.",
        "Push Press|push|front-delts,triceps|quads,glutes|barbell,dumbbell|overhead,axial-loading,explosive|Dip at the knees and drive the weight to press overhead.",
        "Arnold Press|push|front-delts,side-delts|triceps|dumbbell|overhead|Rotate the palms outward as you press overhead.",
        "Landmine Press|push|front-delts,upper-chest|triceps,core|landmine|angled-press,shoulder-friendly|Press the bar up and forward along its natural arc.",
        "Behind-the-Neck Press|push|front-delts,side-delts|triceps|barbell,smith-machine|overhead,behind-neck,axial-loading|Lower the bar behind the head and press overhead.",
        "Pike Push-Up|push|front-delts|triceps|bodyweight|overhead,wrist-weight-bearing,wrist-extension-load|Pike the hips high and lower the head toward the floor.",
        "Handstand Push-Up|push|front-delts,triceps|traps|bodyweight|overhead,wrist-weight-bearing,cervical-load,axial-loading|Kick up against a wall and lower the head toward the floor.",
        "Close-Grip Bench Press|push|triceps,chest|front-delts|barbell,smith-machine|horizontal-press|Grip just inside shoulder width and keep elbows tucked.",
        "Chest Fly|isolation|chest|front-delts|dumbbell,cable,machine|deep-shoulder-stretch-loaded|Open the arms wide with a soft elbow bend and squeeze the chest to return.",
        "Lateral Raise|isolation|side-delts|traps|dumbbell,cable,machine,resistance-band|shoulder-abduction|Raise the arms out to the side until level with the shoulders.",
        "Front Raise|isolation|front-delts|upper-chest|dumbbell,cable,plate|shoulder-flexion-loaded|Raise the weight in front of you to shoulder height.",
        "Triceps Pushdown|isolation|triceps||cable,resistance-band|elbow-extension|Pin the elbows to your sides and extend the arms fully.",
        "Skull Crusher|isolation|triceps||barbell,dumbbell,ez-bar|elbow-flexion-loaded-deep|Lower the weight toward the forehead by bending only at the elbows.",
        "Overhead Triceps Extension|isolation|triceps||dumbbell,cable|overhead|Hold the weight overhead and lower it behind the head.",
        "Bench Dip|push|triceps|chest,front-delts|bodyweight|end-range-shoulder-extension,wrist-extension-load|Hands on a bench behind you, lower until the elbows reach ninety degrees.",
        // ---------- PULL ----------
        "Pull-Up|pull|lats|biceps,rhomboids|pull-up-bar,assisted-machine|overhead,grip-intensive,hanging|Hang from the bar and pull until the chin clears it.",
        "Chin-Up|pull|lats,biceps|rhomboids|pull-up-bar|overhead,grip-intensive,hanging|Use an underhand grip and pull the chest toward the bar.",
        "Lat Pulldown|pull|lats|biceps,rear-delts|cable,machine,resistance-band|overhead|Pull the bar to the upper chest while leaning back slightly.",
        "Straight-Arm Pulldown|pull|lats|triceps,core|cable,resistance-band|shoulder-flexion-loaded|Keep the arms straight and sweep the bar down to the thighs.",
        "Bent-Over Row|pull|lats,rhomboids|biceps,rear-delts,lower-back|barbell,dumbbell|hinged-torso-loaded,grip-intensive|Hinge forward to forty-five degrees and row to the lower ribs.",
        "Chest-Supported Row|pull|rhomboids,lats|biceps,rear-delts|dumbbell,machine|supported|Lie face down on an incline bench and row the weights up.",
        "Seated Cable Row|pull|lats,rhomboids|biceps|cable,machine,resistance-band|supported|Sit tall and row the handle to the stomach.",
        "Single-Arm Row|pull|lats|rhomboids,biceps|dumbbell,kettlebell,cable|unilateral,supported|Brace one hand on a bench and row with the other arm.",
        "Inverted Row|pull|rhomboids,lats|biceps,core|bodyweight,smith-machine,suspension-trainer|low-load|Hang under a bar with a straight body and pull the chest up.",
        "Pendlay Row|pull|lats,rhomboids|lower-back|barbell|hinged-torso-loaded,explosive,grip-intensive|Row the bar explosively from the floor with the torso parallel.",
        "T-Bar Row|pull|lats,rhomboids|lower-back,biceps|landmine,machine|hinged-torso-loaded@landmine,supported@machine|Row the handle toward the chest keeping the chest up.",
        "Face Pull|pull|rear-delts|traps,rotator-cuff|cable,resistance-band|external-rotation,shoulder-friendly|Pull the rope toward the face and rotate the hands outward.",
        "Reverse Fly|isolation|rear-delts|traps,rhomboids|dumbbell,machine,cable|shoulder-friendly|Open the arms out wide, squeezing the shoulder blades.",
        "Upright Row|pull|side-delts,traps|biceps|barbell,cable,dumbbell|internal-rotation-loaded,impingement-position|Pull the weight up along the body to chest height with elbows high.",
        "Biceps Curl|isolation|biceps|forearms|barbell,dumbbell,cable,ez-bar,resistance-band|elbow-flexion|Curl the weight up without swinging the torso.",
        "Hammer Curl|isolation|biceps,forearms||dumbbell,cable,resistance-band|neutral-grip|Use a neutral grip and curl the weight to the shoulder.",
        "Preacher Curl|isolation|biceps||ez-bar,dumbbell,machine|elbow-end-range-loaded|Rest the upper arms on the pad and curl the weight up.",
        "Reverse Curl|isolation|forearms,biceps||barbell,ez-bar,cable|wrist-extension-load|Use an overhand grip and curl the weight up.",
        "Wrist Curl|isolation|forearms||barbell,dumbbell|wrist-flexion-load,grip-intensive|Rest the forearms on a bench and curl the wrists up.",
        "Wrist Extension|isolation|forearms||dumbbell,barbell|wrist-extension-load|Rest the forearms palm-down and lift the back of the hand.",
        "Shrug|isolation|traps|forearms|barbell,dumbbell,trap-bar|grip-intensive,cervical-load|Lift the shoulders straight up toward the ears and pause.",
        // ---------- HINGE ----------
        "Deadlift|hinge|glutes,hamstrings,lower-back|traps,forearms,quads|barbell,trap-bar|axial-loading,grip-intensive,spinal-load-heavy|Push the floor away and stand tall with the bar close to the legs.",
        "Romanian Deadlift|hinge|hamstrings,glutes|lower-back,forearms|barbell,dumbbell,kettlebell|loaded-hamstring-stretch,spinal-shear-load,grip-intensive|Lower the weight along the thighs until you feel a deep stretch.",
        "Stiff-Leg Deadlift|hinge|hamstrings|glutes,lower-back|barbell,dumbbell|loaded-hamstring-stretch,spinal-shear-load|Keep the knees nearly straight and lower the weight to mid-shin.",
        "Single-Leg Romanian Deadlift|hinge|hamstrings,glutes|core|dumbbell,kettlebell,bodyweight|single-leg-balance,loaded-hamstring-stretch,unilateral|Balance on one leg and reach the weight toward the floor.",
        "Good Morning|hinge|hamstrings,lower-back|glutes|barbell,resistance-band|axial-loading@barbell,spinal-shear-load,loaded-hamstring-stretch|With the bar on your back, bow forward until the torso is near parallel.",
        "Hip Thrust|hinge|glutes|hamstrings,quads|barbell,machine,dumbbell|hip-extension-supported|Rest the upper back on a bench and drive the hips up to full extension.",
        "Glute Bridge|hinge|glutes|hamstrings,core|bodyweight,barbell,dumbbell,resistance-band|floor-based,low-spinal-load|Lie on your back and drive the hips up, squeezing the glutes.",
        "Kettlebell Swing|hinge|glutes,hamstrings|core,lower-back|kettlebell|explosive,spinal-shear-load,grip-intensive|Snap the hips forward to float the kettlebell to chest height.",
        "Pull-Through|hinge|glutes,hamstrings|core|cable,resistance-band|low-spinal-load|Face away from the anchor and drive the hips forward.",
        "Back Extension|hinge|lower-back,glutes|hamstrings|roman-chair,bodyweight|spinal-extension-loaded|Lower the torso over the pad and extend until in line with the legs.",
        "Reverse Hyperextension|hinge|glutes,lower-back|hamstrings|machine,bench|spinal-traction|Lie face down on the pad and raise the legs behind you.",
        "Nordic Hamstring Curl|isolation|hamstrings|glutes|bodyweight|eccentric-hamstring-high,loaded-hamstring-stretch|Anchor the heels and lower the torso as slowly as possible.",
        "Leg Curl|isolation|hamstrings|calves|machine,resistance-band,stability-ball|knee-flexion|Curl the heels toward the glutes and control the return.",
        "Rack Pull|hinge|glutes,lower-back,traps|hamstrings,forearms|barbell|axial-loading,grip-intensive,spinal-load-heavy|Pull the bar from pins set just below the knees.",
        // ---------- SQUAT ----------
        "Back Squat|squat|quads,glutes|hamstrings,lower-back,core|barbell,smith-machine|axial-loading,deep-knee-flexion-loaded,deep-hip-flexion-loaded|Sit down between the hips into deep knee flexion and stand back up.",
        "Front Squat|squat|quads|glutes,core,upper-back|barbell|axial-loading,deep-knee-flexion-loaded,wrist-extension-load|Hold the bar in the front rack and squat with an upright torso.",
        "Goblet Squat|squat|quads,glutes|core|dumbbell,kettlebell|deep-knee-flexion-loaded,deep-hip-flexion-loaded|Hold the weight at the chest and squat between the knees.",
        "Box Squat|squat|glutes,quads|hamstrings|barbell,dumbbell,bodyweight|controlled-depth,axial-loading@barbell|Sit back onto a box at parallel, pause, then stand.",
        "Air Squat|squat|quads,glutes|hamstrings|bodyweight|low-load|Squat to a comfortable depth with arms forward for balance.",
        "Leg Press|squat|quads,glutes|hamstrings|machine|supported,deep-knee-flexion-loaded,deep-hip-flexion-loaded|Lower the platform until the knees reach ninety degrees or deeper.",
        "Hack Squat|squat|quads|glutes|machine|deep-knee-flexion-loaded,axial-loading|Lean against the pad and squat down under the shoulder pads.",
        "Bulgarian Split Squat|squat|quads,glutes|hamstrings,adductors|dumbbell,bodyweight,barbell|unilateral,single-leg-balance,deep-knee-flexion-loaded,axial-loading@barbell|Rear foot on a bench, lower the back knee toward the floor.",
        "Walking Lunge|squat|quads,glutes|hamstrings,adductors|dumbbell,bodyweight,barbell|unilateral,deep-knee-flexion-loaded,single-leg-balance,axial-loading@barbell|Step forward and lower the back knee, then step through.",
        "Reverse Lunge|squat|glutes,quads|hamstrings|dumbbell,bodyweight,kettlebell|unilateral,knee-friendly|Step backward and lower until both knees are near ninety degrees.",
        "Step-Up|squat|quads,glutes|hamstrings,calves|dumbbell,bodyweight,barbell|unilateral,single-leg-balance,axial-loading@barbell|Drive through the front foot to step onto the box.",
        "Wall Sit|squat|quads|glutes|bodyweight|isometric,knee-friendly|Slide down the wall to a comfortable knee angle and hold.",
        "Spanish Squat|squat|quads|glutes|resistance-band|isometric,knee-friendly|Loop a band behind the knees and sit back, keeping the shins vertical.",
        "Leg Extension|isolation|quads||machine,resistance-band|open-chain-knee-extension|Extend the knees fully and lower under control.",
        "Terminal Knee Extension|isolation|quads||resistance-band,cable|low-load,knee-friendly|Straighten the knee against the band from a slight bend.",
        "Sissy Squat|squat|quads|core|bodyweight,machine|deep-knee-flexion-loaded,knee-shear|Lean back and drive the knees forward into deep knee flexion.",
        "Pistol Squat|squat|quads,glutes|core|bodyweight,kettlebell|deep-knee-flexion-loaded,single-leg-balance,deep-hip-flexion-loaded|Squat on one leg with the other extended in front.",
        "Jump Squat|squat|quads,glutes|calves|bodyweight,dumbbell|plyometric,high-impact,explosive|Squat down then jump as high as possible and land softly.",
        "Box Jump|squat|quads,glutes|calves,hamstrings|plyo-box|plyometric,high-impact,explosive|Swing the arms and jump onto the box, landing softly.",
        "Calf Raise|isolation|calves||bodyweight,dumbbell,machine,smith-machine|calf-loaded-stretch,axial-loading@smith-machine|Let the heels drop below the step then rise onto the toes.",
        "Seated Calf Raise|isolation|calves||machine,dumbbell|supported|Sit with the pad on the knees and raise the heels.",
        "Hip Adduction|isolation|adductors||machine,cable,resistance-band|groin-load|Squeeze the legs together against resistance.",
        "Hip Abduction|isolation|glutes||machine,cable,resistance-band|low-load|Push the knees outward against resistance.",
        "Copenhagen Plank|isolation|adductors|core,obliques|bodyweight|groin-load-high,isometric|Support the top leg on a bench and lift the hips.",
        // ---------- CARRY ----------
        "Farmer's Carry|carry|forearms,traps|core,glutes|dumbbell,kettlebell,trap-bar|grip-intensive,axial-loading|Hold heavy weights at the sides and walk with short steps.",
        "Suitcase Carry|carry|core,obliques|forearms,traps|dumbbell,kettlebell|grip-intensive,unilateral,anti-lateral-flexion|Carry a weight in one hand without leaning to the side.",
        "Overhead Carry|carry|front-delts,core|traps|dumbbell,kettlebell|overhead,axial-loading|Lock the weight overhead and walk with the ribs down.",
        "Front Rack Carry|carry|core,upper-back|front-delts|kettlebell,sandbag|axial-loading|Hold the weights in the front rack and walk tall.",
        "Sled Push|carry|quads,glutes|calves,core|sled|low-impact,knee-friendly|Lean into the sled and drive with short powerful steps.",
        "Backward Sled Drag|carry|quads|calves|sled|low-impact,knee-friendly|Face the sled and walk backward with the knees bent.",
        // ---------- ROTATION / CORE ----------
        "Pallof Press|rotation|core,obliques||cable,resistance-band|anti-rotation,spine-neutral|Press the handle straight out and resist the rotational pull.",
        "Russian Twist|rotation|obliques|core|bodyweight,medicine-ball,plate|spinal-rotation-loaded,spinal-flexion-loaded|Lean back and rotate the weight from side to side.",
        "Woodchop|rotation|obliques,core|front-delts|cable,resistance-band,medicine-ball|spinal-rotation-loaded|Rotate the torso and pull the handle diagonally across the body.",
        "Landmine Rotation|rotation|obliques,core|front-delts|landmine|spinal-rotation-loaded|Swing the bar end in an arc from hip to hip.",
        "Rotational Throw|rotation|obliques|core,chest|medicine-ball|explosive,spinal-rotation-loaded|Rotate explosively and throw the ball against a wall.",
        "Plank|isolation|core|front-delts|bodyweight|isometric,spine-neutral|Hold a straight line from head to heels on the forearms.",
        "Side Plank|isolation|obliques|core|bodyweight|isometric,shoulder-weight-bearing|Support the body on one forearm and lift the hips.",
        "Dead Bug|isolation|core|hip-flexors|bodyweight,stability-ball|spine-neutral,low-load|Lie on your back and extend opposite arm and leg slowly.",
        "Bird Dog|isolation|core,lower-back|glutes|bodyweight|spine-neutral,wrist-weight-bearing|On hands and knees, extend opposite arm and leg.",
        "Crunch|isolation|core||bodyweight,cable,machine|spinal-flexion-loaded,cervical-load|Curl the ribs toward the pelvis without pulling on the neck.",
        "Sit-Up|isolation|core,hip-flexors||bodyweight,decline-bench|spinal-flexion-loaded,cervical-load|Sit all the way up from lying, keeping the feet anchored.",
        "Hanging Leg Raise|isolation|core,hip-flexors|forearms|pull-up-bar|hanging,grip-intensive,overhead|Hang from the bar and raise the legs to hip height.",
        "Ab Wheel Rollout|isolation|core|lats|ab-wheel|lumbar-extension-stress,wrist-weight-bearing|Roll the wheel forward as far as you can control.",
        "Hollow Body Hold|isolation|core||bodyweight|isometric,spine-neutral|Press the lower back into the floor and hold.",
        "Mountain Climber|isolation|core|hip-flexors,front-delts|bodyweight|wrist-weight-bearing,high-impact|Drive the knees toward the chest quickly from a plank.",
        "Burpee|squat|quads,chest|core,front-delts|bodyweight|plyometric,high-impact,wrist-weight-bearing|Drop to a push-up, jump the feet in and jump up.",
        "Jump Rope|isolation|calves|quads|jump-rope|plyometric,high-impact|Bounce lightly on the balls of the feet.",
        "Stationary Bike Sprint|squat|quads|calves,glutes|stationary-bike|low-impact,knee-friendly|Pedal hard for short intervals with the seat at hip height.",
    };

    private static final Map<String, String> EQUIPMENT_LABEL = new LinkedHashMap<>();
    static {
        String[][] pairs = {
            {"barbell", "Barbell"}, {"dumbbell", "Dumbbell"}, {"smith-machine", "Smith Machine"},
            {"kettlebell", "Kettlebell"}, {"machine", "Machine"}, {"cable", "Cable"},
            {"resistance-band", "Banded"}, {"ez-bar", "EZ-Bar"}, {"trap-bar", "Trap Bar"},
            {"landmine", "Landmine"}, {"assisted-machine", "Assisted"}, {"medicine-ball", "Medicine Ball"},
            {"plate", "Plate"}, {"stability-ball", "Stability Ball"}, {"suspension-trainer", "Suspension"},
            {"bench", "Bench"}, {"decline-bench", "Decline"},
        };
        for (String[] p : pairs) EQUIPMENT_LABEL.put(p[0], p[1]);
    }

    private static final Map<String, String> PATTERN_SENTENCE = Map.of(
        "push", "Press the load away from your body until the arms are extended without slamming the lockout.",
        "pull", "Pull by driving the elbows back and squeezing the shoulder blades together.",
        "hinge", "Hinge at the hips with a neutral spine, pushing the hips back until you feel tension in the hamstrings.",
        "squat", "Keep the knees tracking over the toes and drive up through the mid-foot.",
        "carry", "Walk with short controlled steps, keeping the ribs stacked over the pelvis.",
        "rotation", "Rotate through the thoracic spine while the hips stay stable.",
        "isolation", "Move only at the target joint and avoid swinging or using momentum."
    );

    private static final Map<String, String> TAG_SENTENCE = new LinkedHashMap<>();
    static {
        TAG_SENTENCE.put("axial-loading", "The load is carried through the spine, so brace hard before each rep.");
        TAG_SENTENCE.put("overhead", "Reach fully overhead without arching the lower back.");
        TAG_SENTENCE.put("deep-knee-flexion-loaded", "Descend into deep knee flexion under control.");
        TAG_SENTENCE.put("plyometric", "Land softly with bent knees to absorb the impact.");
        TAG_SENTENCE.put("wrist-weight-bearing", "Spread the fingers and keep weight even through the palms.");
        TAG_SENTENCE.put("grip-intensive", "Maintain a strong grip on the handles throughout.");
        TAG_SENTENCE.put("loaded-hamstring-stretch", "Feel a deep stretch in the hamstrings at the bottom position.");
        TAG_SENTENCE.put("spinal-rotation-loaded", "Rotate the torso against the load.");
        TAG_SENTENCE.put("supported", "The pad or bench supports your torso, reducing spinal load.");
        TAG_SENTENCE.put("isometric", "Hold the position for time while breathing steadily.");
        TAG_SENTENCE.put("knee-friendly", "This keeps stress on the knee joint low.");
        TAG_SENTENCE.put("shoulder-friendly", "The arm path keeps the shoulder in a comfortable range.");
        TAG_SENTENCE.put("spine-neutral", "Keep a neutral spine for the entire set.");
    }

    private record Base(String name, String pattern, List<String> primary, List<String> secondary,
                        List<String> equipment, List<String> rawTags, String cue) { }

    private static List<Base> bases() {
        List<Base> out = new ArrayList<>();
        for (String line : BASES) {
            String[] f = line.split("\\|", -1);
            out.add(new Base(f[0], f[1], csv(f[2]), csv(f[3]), csv(f[4]), csv(f[5]), f[6]));
        }
        return out;
    }

    private static List<String> csv(String s) {
        if (s.isBlank()) return new ArrayList<>();
        return new ArrayList<>(Arrays.asList(s.split(",")));
    }

    /** Resolves "tag@eq1+eq2" conditional tags for one equipment variant. */
    private static List<String> tagsFor(List<String> raw, String equipment) {
        List<String> out = new ArrayList<>();
        for (String t : raw) {
            int at = t.indexOf('@');
            if (at < 0) out.add(t);
            else if (Arrays.asList(t.substring(at + 1).split("\\+")).contains(equipment)) out.add(t.substring(0, at));
        }
        return out;
    }

    private static String displayName(String base, String equipment) {
        String label = EQUIPMENT_LABEL.get(equipment);
        if (label == null || base.startsWith(label)) return base; // avoid "Landmine Landmine Press"
        return label + " " + base;
    }

    private static String instructions(Base b, String equipment, List<String> tags, String extra) {
        StringBuilder sb = new StringBuilder();
        sb.append("Set up with the ").append(equipment.replace('-', ' ')).append(". ");
        sb.append(b.cue()).append(' ');
        sb.append(PATTERN_SENTENCE.get(b.pattern())).append(' ');
        for (Map.Entry<String, String> e : TAG_SENTENCE.entrySet()) {
            if (tags.contains(e.getKey())) sb.append(e.getValue()).append(' ');
        }
        if (extra != null) sb.append(extra).append(' ');
        sb.append("Control the lowering phase for two to three seconds and stop the set if you feel sharp pain.");
        return sb.toString();
    }

    /** The realistic catalog (~300 entries) used by the application. */
    public static List<RawExercise> realistic() {
        List<RawExercise> out = new ArrayList<>();
        Set<String> names = new HashSet<>();
        int[] seq = {1};
        for (Base b : bases()) {
            for (String eq : b.equipment()) {
                List<String> tags = tagsFor(b.rawTags(), eq);
                add(out, names, seq, displayName(b.name(), eq), b, eq, tags, null);
            }
            // tempo / paused variants of the main barbell lifts and single-arm cable/dumbbell isolation work
            String first = b.equipment().get(0);
            if (first.equals("barbell") && (b.pattern().equals("squat") || b.pattern().equals("hinge") || b.pattern().equals("push"))) {
                List<String> tags = new ArrayList<>(tagsFor(b.rawTags(), first));
                tags.add("slow-eccentric");
                add(out, names, seq, "Tempo " + displayName(b.name(), first), b, first, tags,
                        "Use a three-second lowering phase and a one-second pause.");
                List<String> paused = new ArrayList<>(tagsFor(b.rawTags(), first));
                paused.add("paused");
                add(out, names, seq, "Paused " + displayName(b.name(), first), b, first, paused,
                        "Pause for two seconds in the hardest position of the lift.");
            }
            if (b.pattern().equals("isolation") && b.equipment().contains("cable") && !b.name().startsWith("Single")) {
                List<String> tags = new ArrayList<>(tagsFor(b.rawTags(), "cable"));
                tags.add("unilateral");
                add(out, names, seq, "Single-Arm Cable " + b.name(), b, "cable", tags,
                        "Work one side at a time to fix imbalances.");
            }
        }
        return out;
    }

    private static void add(List<RawExercise> out, Set<String> names, int[] seq, String name, Base b,
                            String eq, List<String> tags, String extra) {
        if (!names.add(name.toLowerCase())) return;
        String id = String.format("EX%04d", seq[0]++);
        out.add(new RawExercise(id, name, b.primary(), b.secondary(), List.of(eq), b.pattern(),
                tags, instructions(b, eq, tags, extra)));
    }

    private static final String[] MODIFIERS = {
        "Tempo", "Paused", "Banded", "Deficit", "Elevated", "Isometric", "Kneeling", "Half-Kneeling",
        "Standing", "Seated", "Wide-Grip", "Narrow-Grip", "Reverse-Grip", "Alternating", "Offset",
        "Staggered", "Cluster", "Eccentric", "Partial", "Supported", "Unilateral", "Pulse", "Iso-Hold", "Contrast"
    };

    /**
     * Synthetic catalog of exactly {@code n} unique entries for benchmarking. Each entry is a
     * realistic base exercise with 1–2 random modifiers and a numeric variant suffix.
     */
    public static List<RawExercise> scaled(int n, long seed) {
        List<RawExercise> base = realistic();
        Random rnd = new Random(seed);
        List<RawExercise> out = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            RawExercise b = base.get(rnd.nextInt(base.size()));
            String mod1 = MODIFIERS[rnd.nextInt(MODIFIERS.length)];
            String mod2 = rnd.nextBoolean() ? MODIFIERS[rnd.nextInt(MODIFIERS.length)] + " " : "";
            String name = mod2 + mod1 + " " + b.name() + " v" + i;
            out.add(new RawExercise(String.format("SX%06d", i), name, b.primaryMuscles(), b.secondaryMuscles(),
                    b.equipment(), b.movementPattern(), b.tags(), b.instructions()));
        }
        return out;
    }
}
