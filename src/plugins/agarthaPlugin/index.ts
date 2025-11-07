import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";

const settings = definePluginSettings({
    opacity: {
        type: OptionType.SLIDER,
        description: "Overlay opacity",
        markers: [0, 0.2, 0.4, 0.6, 0.8],
        default: 0.4,
        min: 0,
        max: 0.8,
    },
    volume: {
        type: OptionType.SLIDER,
        description: "Video volume",
        markers: [0, 0.2, 0.4, 0.6, 0.8, 1],
        default: 0.2,
        min: 0,
        max: 1,
    },
});

export default definePlugin({
    name: "Agartha",
    description: "Enters Agartha",
    authors: [
        {
            name: "You",
            id: 0n,
        },
    ],
    settings,

    videoElement: null as HTMLVideoElement | null,
    currentVideoIndex: 0,
    videos: [
        "https://cdn.discordapp.com/attachments/1287309916909867070/1436077088280018995/ssstik.io_dimitriprv_1760726864944.mp4?ex=690e4a82&is=690cf902&hm=a2b3b15e46caaf43298634cba34c85d468f269a5f89dda995c9939b32b927497&",
        "https://cdn.discordapp.com/attachments/1287309916909867070/1436080068245061682/ssstik.io_tipsywefellas_1760724366509.mp4?ex=690e4d49&is=690cfbc9&hm=c933bd68bd3a9eeb7d01e23f797ffa57eb4f138d38fde44ba2bb4934e6c51cc7&",
        "https://cdn.discordapp.com/attachments/1287309916909867070/1436080464736550932/First_Agartha_edit_of_many_agartha_memes_tiktok.mp4?ex=690e4da7&is=690cfc27&hm=f69cab2977b770c680c0c96815fad1cab9597dfdb9ba90f19ea2e70b3a62becc&",
        "https://cdn.discordapp.com/attachments/1287309916909867070/1436080623071531018/agartha_edit.mp4?ex=690e4dcd&is=690cfc4d&hm=773c334186cdb7f97793cbd7222f1c24a045595a1b29660655d6c5bea46cd3f5&",
    ],

    playNextVideo() {
        if (!this.videoElement) return;

        this.currentVideoIndex =
            (this.currentVideoIndex + 1) % this.videos.length;
        this.videoElement.src = this.videos[this.currentVideoIndex];
        this.videoElement.play().catch((err) => {
            console.error("Agartha: Failed to play video", err);
        });
    },

    start() {
        // Create video element
        this.videoElement = document.createElement("video");
        this.videoElement.id = "agartha-overlay";
        this.videoElement.src = this.videos[0];

        // Set video properties
        this.videoElement.autoplay = true;
        this.videoElement.muted = false;
        this.videoElement.volume = settings.store.volume; // Use setting

        // Apply styles for overlay and click-through
        this.videoElement.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            object-fit: cover;
            z-index: 9999;
            opacity: ${settings.store.opacity};
            pointer-events: none;
        `;

        // Handle video ending to play next one
        this.videoElement.addEventListener("ended", () => this.playNextVideo());

        // Append to body
        document.body.appendChild(this.videoElement);

        // Start playing
        this.videoElement.play().catch((err) => {
            console.error("Agartha: Failed to play video", err);
        });
    },

    stop() {
        // Remove video element when plugin is disabled
        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.removeEventListener("ended", () =>
                this.playNextVideo(),
            );
            this.videoElement.remove();
            this.videoElement = null;
        }
        this.currentVideoIndex = 0;
    },
});
