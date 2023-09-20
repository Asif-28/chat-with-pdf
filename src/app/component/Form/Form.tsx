"use client";
import axios from "axios";
import React, { FormEvent } from "react";

const Form = () => {
  const submitHandler = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const pdf = await axios.get("http://localhost:3000/api/form");
      console.log(pdf);
    } catch (error: any) {
      console.log(error.message);
    }
  };
  return (
    <div className="">
      <form
        onSubmit={submitHandler}
        className="flex flex-col items-center h-[100vh] pt-[10%]"
      >
        <h2 className="text-3xl mb-6 uppercase ">Upload Your Pdf </h2>
        <div className="flex flex-col gap-5  bg-white text-[#000] pt-12 pb-8 px-4 rounded-lg">
          <label className="text-xl" htmlFor="document">
            Upload Document
          </label>
          <input className="" type="file" />
          <button
            className="mt-7 bg-red-500 text-base text-[#fff] py-2 rounded-lg hover:bg-red-600"
            type="submit"
          >
            Submit
          </button>
        </div>
      </form>
    </div>
  );
};

export default Form;
