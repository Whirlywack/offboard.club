import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getProfile, requireSignedUp } from "@/lib/auth";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Edit your Profile" };

export default function EditProfile() {
  return (
    <main>
      <h1>Edit your Profile</h1>
      <p>
        Members see your name and photo from LinkedIn and whatever you fill in here. Every field is optional: empty one
        and save to clear it.
      </p>
      <Suspense>
        <Edit />
      </Suspense>
    </main>
  );
}

async function Edit() {
  const { id } = await requireSignedUp();
  return (
    <>
      <ProfileForm saved={await getProfile(id)} />
      <p>
        <Link href={`/profiles/${id}`}>See your Profile</Link>
      </p>
      <p>
        <Link href="/">Home</Link>
      </p>
    </>
  );
}
