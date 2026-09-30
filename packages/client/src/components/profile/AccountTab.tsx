import { type FormEvent } from "react";
import { Loader2, AlertCircle, CheckCircle2, Camera } from "lucide-react";
import type { AuthUser } from "../../context/AuthContext.js";

const inputClass =
  "w-full rounded-xl border border-dark-200 px-3 py-2 text-sm text-white bg-dark placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-transparent";

interface AccountTabProps {
  user: AuthUser | null;
  name: string; setName: (v: string) => void;
  bio: string; setBio: (v: string) => void;
  addressLine1: string; setAddressLine1: (v: string) => void;
  addressLine2: string; setAddressLine2: (v: string) => void;
  suburb: string; setSuburb: (v: string) => void;
  stateProv: string; setStateProv: (v: string) => void;
  country: string; setCountry: (v: string) => void;
  postcode: string; setPostcode: (v: string) => void;
  facebook: string; setFacebook: (v: string) => void;
  instagram: string; setInstagram: (v: string) => void;
  tiktok: string; setTiktok: (v: string) => void;
  pinterest: string; setPinterest: (v: string) => void;
  linkedin: string; setLinkedin: (v: string) => void;
  profileMsg: string;
  profileError: string;
  savingProfile: boolean;
  handleSaveProfile: (e: FormEvent) => void;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  avatarError: string;
  handleAvatarUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function AccountTab({
  user,
  name, setName,
  bio, setBio,
  addressLine1, setAddressLine1,
  addressLine2, setAddressLine2,
  suburb, setSuburb,
  stateProv, setStateProv,
  country, setCountry,
  postcode, setPostcode,
  facebook, setFacebook,
  instagram, setInstagram,
  tiktok, setTiktok,
  pinterest, setPinterest,
  linkedin, setLinkedin,
  profileMsg, profileError, savingProfile,
  handleSaveProfile,
  avatarInputRef, avatarError, handleAvatarUpload,
}: AccountTabProps) {
  return (
    <form onSubmit={handleSaveProfile} role="tabpanel" id="profile-tabpanel-account" aria-labelledby="profile-tab-account" className="bg-dark-50 rounded-2xl border border-dark-200 p-6 space-y-4">
      {profileMsg && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <CheckCircle2 className="size-4 flex-shrink-0" /> {profileMsg}
        </div>
      )}
      {profileError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {profileError}
        </div>
      )}

      <div className="flex items-center gap-4 mb-6 pb-6 border-b border-dark-200">
        <div className="relative">
          <div className="size-24 rounded-full bg-dark-200 flex items-center justify-center overflow-hidden">
            {user?.userPhotoPath ? (
              <img src={user.userPhotoPath} alt="Avatar" className="size-full object-cover" />
            ) : (
              <span className="text-2xl font-bold text-dark-500">{user?.userName?.charAt(0)?.toUpperCase() ?? "?"}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            className="absolute -bottom-1 -right-1 p-1.5 bg-gold text-dark rounded-full hover:bg-gold-hover transition-colors"
          >
            <Camera className="size-4" />
          </button>
        </div>
        <div>
          <p className="font-medium text-[#FAFAFA]">{user?.userName}</p>
          <p className="text-sm text-dark-600">{user?.userEmail}</p>
        </div>
        <input
          ref={avatarInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={handleAvatarUpload}
        />
      </div>
      {avatarError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {avatarError}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Email</label>
        <input type="email" value={user?.userEmail ?? ""} disabled className={`${inputClass} bg-dark-100 text-dark-500`} />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Bio</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, 300))}
          maxLength={300}
          rows={3}
          placeholder="Tell us about yourself..."
          className={`${inputClass} resize-none`}
        />
        <p className="text-xs text-dark-500 mt-1">{bio.length}/300</p>
      </div>

      <div className="border-t border-dark-200 pt-4 mt-2">
        <h3 className="text-sm font-semibold text-[#E5E5E5] mb-3">Address</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-dark-600 mb-1">Address Line 1</label>
            <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-xs text-dark-600 mb-1">Address Line 2</label>
            <input type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-dark-600 mb-1">Suburb / City</label>
              <input type="text" value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-dark-600 mb-1">State / Province</label>
              <input type="text" value={stateProv} onChange={(e) => setStateProv(e.target.value)} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-dark-600 mb-1">Country</label>
              <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-dark-600 mb-1">Postcode</label>
              <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputClass} />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-dark-200 pt-4 mt-2">
        <h3 className="text-sm font-semibold text-[#E5E5E5] mb-3">Social Media Accounts</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-dark-600 mb-1">Facebook</label>
            <input type="url" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs text-dark-600 mb-1">Instagram</label>
            <input type="url" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs text-dark-600 mb-1">TikTok</label>
            <input type="url" value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs text-dark-600 mb-1">Pinterest</label>
            <input type="url" value={pinterest} onChange={(e) => setPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs text-dark-600 mb-1">LinkedIn</label>
            <input type="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/yourprofile" className={inputClass} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={savingProfile}
          className="px-4 py-2 text-sm font-medium text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 transition-colors"
        >
          {savingProfile && <Loader2 className="size-4 animate-spin inline mr-1" />}
          Save
        </button>
      </div>
    </form>
  );
}

